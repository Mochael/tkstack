# How DST schedules and checks a run — code review

`Tandem @ eb7a3fa` · Gatekeeper → choose a step → apply it → check state → filter faults → replay

## 1. How can the simulator see stopped calls?

```review-diff:packages/gatekeeper/src/Gatekeeper.ts
@new:63	The simulator needs both ends of a handoff to know what it can advance or drop.
@new:80	The harness exposes a snapshot of calls currently held by a gate.
@new:262	Each call contributes at most one current stop. The scheduler never receives stale stops.
@new:565	Finished calls and calls already being controlled are excluded; every returned call is actionable.
--- PATCH ---
diff --git a/packages/gatekeeper/src/Gatekeeper.ts b/packages/gatekeeper/src/Gatekeeper.ts
index 9335ba7..5d4f71c 100644
--- a/packages/gatekeeper/src/Gatekeeper.ts
+++ b/packages/gatekeeper/src/Gatekeeper.ts
@@ -56,6 +56,13 @@ export class CallHandle<Result> {
 	}
 }
 
+export type PendingCall = {
+	readonly handle: CallHandle<unknown>
+	readonly label: string
+	readonly sentBy: string
+	readonly waitingFor: string
+}
+
 type AsyncMethodResult<Method> = Method extends (
 	...args: infer Args
 ) => PromiseLike<infer Result>
@@ -70,6 +77,7 @@ export type Harness<Services extends Record<string, object>> =
 	AsyncDisposable & {
 		[Name in keyof Services]: ServiceProxy<Services[Name]>
 	} & {
+		pendingCalls(): readonly PendingCall[]
 		activateGates(): Promise<void>
 		deactivateGates(): Promise<void>
 		deactivateGatesAndSettle(): Promise<void>
@@ -248,6 +257,11 @@ class Runtime {
 		this.calls.delete(call)
 	}
 
+	private pendingCalls(): readonly PendingCall[] {
+		this.assertUsable()
+		return [...this.calls].flatMap((call) => call.pendingCall() ?? [])
+	}
+
 	private activateGates(): Promise<void> {
 		this.assertUsable()
 		this.gatesActive = true
@@ -547,6 +561,20 @@ class Call {
 		})
 	}
 
+	pendingCall(): PendingCall | undefined {
+		if (this.outcome || this.controlError || this.controlling) return undefined
+		const interaction = this.currentInteraction()
+		if (interaction?.phase !== "enter" && interaction?.phase !== "exit") {
+			return undefined
+		}
+		return {
+			handle: this.handle,
+			label: this.label,
+			sentBy: interaction.sentBy.name,
+			waitingFor: interaction.waitingFor.name,
+		}
+	}
+
 	continueTo(serviceName: string): Promise<void> {
 		return this.control(async () => {
 			const interaction = this.requireCurrent()
```

## 2. How does one step leave other work in flight?

```review-diff:dst/DstSimulation.ts
@old:304	Before: one commit ran to completion within the step, so another write could not overlap it.
@new:314	Now a write starts and stays in flight. A later step may start another write or advance this one.
@new:325	At each step, the simulator refreshes the list of calls it can act on.
@new:346	The cap still allows a second mutation while the first call is paused.
@new:353	Advance releases just this call's current gate; the backend alone does not choose the whole interleaving.
--- PATCH ---
diff --git a/dst/DstSimulation.ts b/dst/DstSimulation.ts
index 5dca6fd..fe813c8 100644
--- a/dst/DstSimulation.ts
+++ b/dst/DstSimulation.ts
@@ -270,42 +309,54 @@ export class DstSimulation {
 					item,
 				})
 			}
+			// The handle arrives only once the commit reaches a boundary, which may
+			// wait on another held call. Its call shows up in pendingCalls() then.
+			inFlight.push(client.commit(tx))
+		}
 
-			const commit = await client.commit(tx)
-
-			if (faultRate > 0 && this.rng.boolean(faultRate)) {
-				// Faults model lost network messages, so deliver this client's timer
-				// ticks until the call is held at a handoff with the server.
-				let boundary = findPending(commit)
-				while (boundary && isTimerHandoff(boundary)) {
-					await commit.continueTo(boundary.waitingFor)
-					this.trace.push({ type: "deliverTick", step, client: clientName })
-					boundary = findPending(commit)
-				}
+		const poolOfIds = ["item-1", "item-2", "item-3"]
+		const faultRate = this.options.faultRate ?? 0
+		// Controls resolve when their call reaches its next boundary, which can
+		// depend on other held calls, so a step starts them without waiting.
+		const inFlight: Promise<unknown>[] = []
+		let maxPendingCalls = 0
 
-				if (boundary) {
-					const error = new Error(
-						`Simulated Network/Push Fault at step ${step}`,
-					)
-					this.trace.push({
-						type: "fault",
-						step,
-						client: clientName,
-						sentBy: boundary.sentBy,
-						waitingFor: boundary.waitingFor,
-						error: error.message,
-					})
-					await commit.fail(error)
-					await commit.result.catch(() => {})
-					continue
-				}
+		for (let step = 0; step < this.options.steps; step++) {
+			const pending = gatekeeper.pendingCalls()
+			// Name calls in creation order so trace names do not depend on choices.
+			for (const call of pending) nameCall(call)
+			maxPendingCalls = Math.max(maxPendingCalls, pending.length)
+			// Faults model lost network messages, never a timer that fails to tick.
+			const droppable = pending.filter((call) => !isTimerHandoff(call))
+
+			if (
+				faultRate > 0 &&
+				droppable.length > 0 &&
+				this.rng.boolean(faultRate)
+			) {
+				const target = this.rng.pick(droppable)
+				const kind = faultKind(target, deliveredEvents.has(target.handle))
+				const record = boundary(target)
+				this.trace.push({ type: "drop", step, fault: kind, ...record })
+				inFlight.push(
+					target.handle.fail(new DstFaultError({ call: record.call, kind })),
+				)
+			} else if (
+				pending.length === 0 ||
+				(pending.length < maxCallsInFlight && this.rng.boolean(mutateRate))
+			) {
+				mutate(step)
+			} else {
+				const target = this.rng.pick(pending)
+				this.trace.push({ type: "advance", step, ...boundary(target) })
+				deliveredEvents.add(target.handle)
+				inFlight.push(target.handle.continueTo(target.waitingFor))
 			}
-
-			await commit.continueToCompletion()
-			this.trace.push({ type: "complete", step, client: clientName })
+			await settle()
 		}
 
 		await gatekeeper.deactivateGatesAndSettle()
+		await Promise.all(inFlight)
 
 		const byId = (a: DstTodo, b: DstTodo) => a.id.localeCompare(b.id)
 		for (const name of clientNames) {
```

## 3. What does an enabled event do to the test world?

```review-diff:dst/DstWorld.ts
@new:344	The world gives each stopped call a stable name for the saved trace and replay.
@new:355	A set or remove begins a local client write.
@new:359	Advance releases one handoff. The promise remains in flight if it later stops again.
@new:366	Drop fails that exact handoff, simulating a lost network message.
@new:379	Restart creates a new client incarnation over its durable storage.
@new:398	After each event settles, compare observed state with an independent model.
--- PATCH ---
diff --git a/dst/DstWorld.ts b/dst/DstWorld.ts
new file mode 100644
--- /dev/null
+++ b/dst/DstWorld.ts
@@ -0,0 +341,59 @@
+	/** Calls held at a boundary, named in creation order so names never depend on choices. */
+	pending(): readonly DstPendingCall[] {
+		this.held = this.harness
+			.pendingCalls()
+			.map((call) => ({ ...call, name: this.nameCall(call) }))
+		this.maxPendingCalls = Math.max(this.maxPendingCalls, this.held.length)
+		return this.held
+	}
+
+	/** Applies one event and returns its trace record. */
+	async apply(step: number, intent: DstIntent): Promise<DstTraceRecord> {
+		switch (intent.type) {
+			case "set":
+			case "remove":
+				return this.write(step, intent)
+			case "advance": {
+				const target = this.find(intent.call)
+				this.deliveredEvents.add(target.handle)
+				this.inFlight.push(target.handle.continueTo(target.waitingFor))
+				return { type: "advance", step, ...boundaryOf(target) }
+			}
+			case "drop": {
+				const target = this.find(intent.call)
+				const kind = faultKind(target, this.deliveredEvents.has(target.handle))
+				this.inFlight.push(
+					target.handle.fail(new DstFaultError({ call: target.name, kind })),
+				)
+				return { type: "drop", step, fault: kind, ...boundaryOf(target) }
+			}
+			case "crash":
+				this.crashed.add(intent.client)
+				this.loaded.delete(intent.client)
+				this.model.crashed(intent.client)
+				await this.harness.crash(intent.client)
+				return { type: "crash", step, client: intent.client }
+			case "restart": {
+				this.crashed.delete(intent.client)
+				this.generations[intent.client] += 1
+				await this.harness.restart(intent.client)
+				this.inFlight.push(this.boot(intent.client))
+				return {
+					type: "restart",
+					step,
+					client: intent.client,
+					clientId: this.harness[intent.client].clientId,
+				}
+			}
+		}
+	}
+
+	hasPending(call: string): boolean {
+		return this.held.some(({ name }) => name === call)
+	}
+
+	/** Lets the step settle, then checks every running client against the model. */
+	async check(step: number): Promise<DstViolation | undefined> {
+		await settle()
+		return this.checkClients(step)
+	}
```

## 4. What state should the clients and server have?

```review-diff:dst/ReferenceModel.ts
@new:32	The model tracks server state independently from Tandem's implementation.
@new:37	A local write remains pending until a pull acknowledges it.
@new:46	Only mutations the server actually accepted change expected server state.
@new:75	An acknowledgement removes only writes through the acknowledged mutation.
@new:90	Expected client state combines its last received server state with its own unacknowledged writes.
--- PATCH ---
diff --git a/dst/ReferenceModel.ts b/dst/ReferenceModel.ts
new file mode 100644
--- /dev/null
+++ b/dst/ReferenceModel.ts
@@ -0,0 +31,70 @@
+export class ReferenceModel<Client extends string> {
+	private readonly server = new Map<string, DstTodo>()
+	private readonly pending = new Map<Client, DstWrite[]>()
+	private readonly received = new Map<Client, Map<string, DstTodo>>()
+
+	wrote(client: Client, write: DstWrite): void {
+		this.pending.set(client, [...(this.pending.get(client) ?? []), write])
+	}
+
+	/** The server committed these mutations. */
+	accepted(mutations: readonly Mutation<DstSchema>[]): void {
+		for (const { ops } of mutations) {
+			for (const op of ops) {
+				if (op.collection !== "todos") continue
+				apply(
+					this.server,
+					op.type === "set"
+						? { type: "set", item: op.value }
+						: { type: "remove", id: String(op.id) },
+				)
+			}
+		}
+	}
+
+	/** A pull response reached the client. */
+	pulled(client: Client, args: PullArgs, response: PullResponse): void {
+		// The server re-reads the window, and sends all of it, whenever the
+		// client's cookie is stale. Otherwise the response changes nothing.
+		if (args.cookie === undefined || response.cookie !== args.cookie) {
+			this.received.set(
+				client,
+				new Map(
+					(response.patch.set ?? [])
+						.filter((record) => record.collection === "todos")
+						.map(({ value }) => [value.id, value]),
+				),
+			)
+		}
+		if (response.lastMutationId === undefined) return
+		const pending = this.pending.get(client) ?? []
+		const acknowledged = pending.findIndex(
+			({ mutationId }) => mutationId === response.lastMutationId,
+		)
+		if (acknowledged >= 0) {
+			this.pending.set(client, pending.slice(acknowledged + 1))
+		}
+	}
+
+	/** A crash forgets the incarnation; the restarted one must pull again. */
+	crashed(client: Client): void {
+		this.pending.delete(client)
+		this.received.delete(client)
+	}
+
+	/** What the client should show now, or undefined before its first pull. */
+	expected(client: Client): DstTodo[] | undefined {
+		const received = this.received.get(client)
+		if (!received) return undefined
+		const state = new Map(received)
+		for (const { op } of this.pending.get(client) ?? []) apply(state, op)
+		return [...state.values()].sort(byId)
+	}
+
+	serverState(): DstTodo[] {
+		return [...this.server.values()].sort(byId)
+	}
+
+	unacknowledged(client: Client): readonly DstWrite[] {
+		return this.pending.get(client) ?? []
+	}
```

## 5. Which handoffs may a fault drop?

```review-diff:dst/DstSimulation.ts
@old:100	Before: anything that was not a timer, including a local storage write, could be dropped.
@new:100	Now only calls crossing the client/server boundary enter the fault lottery.
--- PATCH ---
diff --git a/dst/DstSimulation.ts b/dst/DstSimulation.ts
index 55b07a1..b2dfe21 100644
--- a/dst/DstSimulation.ts
+++ b/dst/DstSimulation.ts
@@ -96,8 +96,8 @@ export class DstSimulation {
 	): DstIntent | undefined {
 		const faultRate = this.options.faultRate ?? 0
 		const crashRate = this.options.crashRate ?? 0
-		// Faults model lost network messages, never a timer that fails to tick.
-		const droppable = pending.filter((call) => !isTimerHandoff(call))
+		// Faults model lost network messages, never a failed timer or disk write.
+		const droppable = pending.filter(isNetworkHandoff)
 		const { down, running, writers } = world
 
 		// Without crashes these draw nothing, so crash-free runs are unchanged.
```

## 6. How is a network handoff identified?

```review-diff:dst/DstWorld.ts
@old:171	The old predicate could only rule out timer calls; it said nothing about disk writes.
@new:175	A request, response, or poke has the server on one side. Timers and local storage do not.
--- PATCH ---
diff --git a/dst/DstWorld.ts b/dst/DstWorld.ts
index ba94ca3..e82d0a6 100644
--- a/dst/DstWorld.ts
+++ b/dst/DstWorld.ts
@@ -167,8 +167,12 @@ class DstTimer implements TimerApi {
 
 const timerGates = { gates: { enter: false, exit: true } }
 
-export function isTimerHandoff({ sentBy, waitingFor }: PendingCall): boolean {
-	return sentBy.endsWith("Timer") || waitingFor.endsWith("Timer")
+/**
+ * A handoff that crosses the network: a request to the server, its reply, or a
+ * poke. Timer ticks and storage writes are local, so a fault never drops them.
+ */
+export function isNetworkHandoff({ sentBy, waitingFor }: PendingCall): boolean {
+	return sentBy === "server" || waitingFor === "server"
 }
 
 export const clientNames = ["client1", "client2"] as const
```

## 7. How does a saved failure run again?

```review-diff:dst/DstReplay.ts
@new:99	Replay reads the recorded choice for this step instead of asking the random generator again.
@new:101	If that event is no longer possible, replay reports the first point of divergence.
@new:110	The same event is applied to a fresh world.
@new:125	The same independent check should reproduce the bug at the same step.
--- PATCH ---
diff --git a/dst/DstReplay.ts b/dst/DstReplay.ts
new file mode 100644
--- /dev/null
+++ b/dst/DstReplay.ts
@@ -0,0 +95,35 @@
+	let violation: DstViolation | undefined
+	let stepsCompleted = steps
+	for (let step = 0; step < steps; step++) {
+		world.pending()
+		const expected = events.get(step)
+		if (expected) {
+			const reason = cannotApply(world, expected)
+			if (reason) {
+				await world.drain()
+				return {
+					stepsCompleted: step,
+					violation: undefined,
+					divergence: { step, expected, reason },
+				}
+			}
+			const actual = await world.apply(step, intentOf(expected))
+			if (JSON.stringify(actual) !== JSON.stringify(expected)) {
+				await world.drain()
+				return {
+					stepsCompleted: step,
+					violation: undefined,
+					divergence: {
+						step,
+						expected,
+						actual,
+						reason: "the event applied differently",
+					},
+				}
+			}
+		}
+		violation = await world.check(step)
+		if (violation) {
+			stepsCompleted = step + 1
+			break
+		}
```
