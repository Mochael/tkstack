# Follow one DST step through the code

`Tandem @ eb7a3fa`

**Run:** 1 Start → 2 Read paused calls → 3 Choose one action → 4A Write or 4B Control → 5 Check. A passing step returns to 2; after the configured steps, 6 checks the settled system.

**Example:** One step starts a client commit. After that step settles, the next step can see its paused call and start another write, advance it, or drop a server handoff. A mismatch can be reproduced at 7.

## 1. Start: execute() boots the world, then enters the step loop

**Input:** seed and step count → **Output:** two booted clients, a server, and the first call to world.pending()

**The run loop**

```review-diff:dst/DstSimulation.ts
@new:57	Creates the server, clients, Gatekeeper, and reference model before any step runs.
@new:65	Every step first reads paused calls, then chooses one possible action.
@new:67	The chosen action becomes a trace record; it need not finish a whole commit.
@new:73	After applying the action, check state before starting the next step.
--- PATCH ---
diff --git a/dst/DstSimulation.ts b/dst/DstSimulation.ts
--- a/dst/DstSimulation.ts
+++ b/dst/DstSimulation.ts
@@ -53,0 +54,24 @@
+	async execute(sink?: DstArtifactSink): Promise<DstRunResult> {
+		const { seed, steps } = this.options
+		sink?.write({ kind: "header", format: 1, options: this.options })
+		await using world = await DstWorld.start(seed)
+		// Drives choices only; ids come from their own streams.
+		const rng = new SimPrng(seed)
+		const trace: DstTraceRecord[] = []
+
+		let violation: DstViolation | undefined
+		let stepsCompleted = steps
+		for (let step = 0; step < steps; step++) {
+			const intent = this.choose(rng, world, world.pending(), step)
+			if (intent) {
+				const record = await world.apply(step, intent)
+				trace.push(record)
+				sink?.write({ kind: "event", ...record })
+			}
+			// Stop at the first step that disagrees with the model, so the trace
+			// ends where the bug happened.
+			violation = await world.check(step)
+			if (violation) {
+				stepsCompleted = step + 1
+				break
+			}
```

**World setup**

```review-diff:dst/DstWorld.ts
@new:321	Both clients connect before fault-controlled steps begin.
@new:322	From this point, handoffs can stop and the loop can order them.
--- PATCH ---
diff --git a/dst/DstWorld.ts b/dst/DstWorld.ts
new file mode 100644
--- /dev/null
+++ b/dst/DstWorld.ts
@@ -0,0 +304,20 @@
+	static async start(seed: number): Promise<DstWorld> {
+		const model = new ReferenceModel<DstClientName>()
+		const server = new TandemServer<DstSchema, {}>({
+			schema: dstSchemaDefinition,
+			relations: {},
+			storage: new InMemoryServerStorage(),
+			rng: SimPrng.idSource(seed, "server"),
+		})
+		let world: DstWorld | undefined
+		const harness = buildHarness({
+			server,
+			model,
+			// A restart runs the factory again with the next generation's ids.
+			idSource: (label) =>
+				SimPrng.idSource(seed, `${label}.${world?.generations[label] ?? 0}`),
+		})
+		world = new DstWorld(server, model, harness)
+		for (const name of clientNames) await world.boot(name)
+		await harness.activateGates()
+		return world
```

## 2. Read: world.pending() gives choose() the calls stopped right now

**Input:** Gatekeeper calls held at their current boundary → **Output:** one snapshot of named, actionable paused calls

**World asks Gatekeeper**

```review-diff:dst/DstWorld.ts
@new:344	The first snapshot may be empty. Later snapshots include commits that reached a gate.
@new:345	Stable names let the trace refer to the same call during replay.
--- PATCH ---
diff --git a/dst/DstWorld.ts b/dst/DstWorld.ts
new file mode 100644
--- /dev/null
+++ b/dst/DstWorld.ts
@@ -0,0 +341,8 @@
+	/** Calls held at a boundary, named in creation order so names never depend on choices. */
+	pending(): readonly DstPendingCall[] {
+		this.held = this.harness
+			.pendingCalls()
+			.map((call) => ({ ...call, name: this.nameCall(call) }))
+		this.maxPendingCalls = Math.max(this.maxPendingCalls, this.held.length)
+		return this.held
+	}
```

**Gatekeeper reports only the current stop**

```review-diff:packages/gatekeeper/src/Gatekeeper.ts
@new:262	Each call contributes at most one current stop.
@new:565	Finished or already controlled calls are not offered to the loop.
@new:566	The stop says who sent the call and which service it waits for.
--- PATCH ---
diff --git a/packages/gatekeeper/src/Gatekeeper.ts b/packages/gatekeeper/src/Gatekeeper.ts
index 9335ba7..5d4f71c 100644
--- a/packages/gatekeeper/src/Gatekeeper.ts
+++ b/packages/gatekeeper/src/Gatekeeper.ts
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

## 3. Choose: the pending snapshot becomes one enabled action

**Input:** paused calls plus which clients can write, crash, or restart → **Output:** one set, remove, advance, drop, crash, or restart intent

**Only server handoffs may be dropped**

```review-diff:dst/DstSimulation.ts
@old:100	The old test could also drop a local storage write.
@new:100	The fault choice now considers only handoffs crossing the server boundary.
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

**The chooser selects one possible event**

```review-diff:dst/DstSimulation.ts
@new:111	A drop is possible only when a droppable call exists and this seeded draw selects it.
@new:116	A new write may start even while another call is paused.
@new:133	Otherwise the loop can pick one held call to move forward.
--- PATCH ---
diff --git a/dst/DstSimulation.ts b/dst/DstSimulation.ts
--- a/dst/DstSimulation.ts
+++ b/dst/DstSimulation.ts
@@ -102,0 +103,33 @@
+		// Without crashes these draw nothing, so crash-free runs are unchanged.
+		if (down.length > 0 && rng.boolean(restartRate)) {
+			return { type: "restart", client: rng.pick(down) }
+		}
+		if (crashRate > 0 && running.length > 0 && rng.boolean(crashRate)) {
+			return { type: "crash", client: rng.pick(running) }
+		}
+		if (faultRate > 0 && droppable.length > 0 && rng.boolean(faultRate)) {
+			return { type: "drop", call: rng.pick(droppable).name }
+		}
+		if (
+			writers.length > 0 &&
+			(pending.length === 0 ||
+				(pending.length < maxCallsInFlight && rng.boolean(mutateRate)))
+		) {
+			const client = rng.pick(writers)
+			const id = rng.pick(poolOfIds)
+			if (rng.boolean(0.2)) return { type: "remove", client, id }
+			return {
+				type: "set",
+				client,
+				item: {
+					id,
+					text: `Note ${id} (rev ${step})`,
+					done: rng.boolean(0.3),
+					priority: rng.int(1, 5),
+				},
+			}
+		}
+		if (pending.length > 0) {
+			return { type: "advance", call: rng.pick(pending).name }
+		}
+		return undefined
```

**What counts as a server handoff**

```review-diff:dst/DstWorld.ts
@new:175	A request, reply, or poke touches the server. Local timer and disk calls do not.
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

## 4A. If set/remove: apply() starts a commit and leaves it in flight

**Input:** a set or remove intent from choose() → **Output:** a local write plus a commit promise that can pause at a gate

**Start the client mutation**

```review-diff:dst/DstWorld.ts
@new:463	The chosen client opens a local transaction.
@new:475	The independent model records the write before any server acknowledgement.
@new:479	The commit starts without waiting for completion. Its next stop can appear in step 2 on a later iteration.
--- PATCH ---
diff --git a/dst/DstWorld.ts b/dst/DstWorld.ts
new file mode 100644
--- /dev/null
+++ b/dst/DstWorld.ts
@@ -0,0 +458,24 @@
+	private write(
+		step: number,
+		intent: Extract<DstIntent, { type: "set" | "remove" }>,
+	): DstTraceRecord {
+		const client = this.harness[intent.client]
+		const tx = client.transact()
+		let op: DstOp
+		if (intent.type === "remove") {
+			tx.remove("todos", intent.id)
+			op = { type: "remove", id: intent.id }
+		} else {
+			tx.set("todos", intent.item)
+			op = { type: "set", item: intent.item }
+		}
+		// Removing a record the client does not show records no op, so nothing
+		// is written or synced.
+		if (tx.ops.length > 0) {
+			this.model.wrote(intent.client, { mutationId: tx.tupleDbTx.id, op })
+		}
+		// The handle arrives only once the commit reaches a boundary, which may
+		// wait on another held call. Its call shows up in pending() then.
+		this.inFlight.push(client.commit(tx))
+		return { ...intent, step, mutationId: tx.tupleDbTx.id }
+	}
```

## 4B. If advance/drop/crash/restart: apply() controls one existing action

**Input:** a named paused call or a running/down client → **Output:** one call moved or failed, or one client lifecycle change

**Apply the chosen branch**

```review-diff:dst/DstWorld.ts
@new:359	Advance releases this call toward its next boundary, where it may pause again.
@new:366	Drop fails this particular handoff.
@new:374	Crash stops one running client.
@new:379	Restart creates a new client over the same durable storage.
--- PATCH ---
diff --git a/dst/DstWorld.ts b/dst/DstWorld.ts
new file mode 100644
--- /dev/null
+++ b/dst/DstWorld.ts
@@ -0,0 +350,40 @@
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
```

## 5. Check: settle launched work, compare state, then loop or stop

**Input:** effects of 4A or 4B, including any server response that arrived → **Output:** a violation, or another iteration beginning at step 2

**Wait only for this step to settle**

```review-diff:dst/DstWorld.ts
@new:397	Promise continuations reach a stable boundary; this does not finish every commit.
@new:398	Then compare each running client with the reference model.
--- PATCH ---
diff --git a/dst/DstWorld.ts b/dst/DstWorld.ts
new file mode 100644
--- /dev/null
+++ b/dst/DstWorld.ts
@@ -0,0 +395,5 @@
+	/** Lets the step settle, then checks every running client against the model. */
+	async check(step: number): Promise<DstViolation | undefined> {
+		await settle()
+		return this.checkClients(step)
+	}
```

**Compute what a client should show**

```review-diff:dst/ReferenceModel.ts
@new:89	Begin with the last server state this client received.
@new:90	Overlay this client’s own writes that are still unacknowledged.
--- PATCH ---
diff --git a/dst/ReferenceModel.ts b/dst/ReferenceModel.ts
new file mode 100644
--- /dev/null
+++ b/dst/ReferenceModel.ts
@@ -0,0 +85,8 @@
+	/** What the client should show now, or undefined before its first pull. */
+	expected(client: Client): DstTodo[] | undefined {
+		const received = this.received.get(client)
+		if (!received) return undefined
+		const state = new Map(received)
+		for (const { op } of this.pending.get(client) ?? []) apply(state, op)
+		return [...state.values()].sort(byId)
+	}
```

**Compare expected with actual**

```review-diff:dst/DstWorld.ts
@new:529	Read the real client database, independently of the model.
@new:531	A mismatch stops the run at this step; otherwise execute() starts the next iteration.
--- PATCH ---
diff --git a/dst/DstWorld.ts b/dst/DstWorld.ts
new file mode 100644
--- /dev/null
+++ b/dst/DstWorld.ts
@@ -0,0 +525,11 @@
+	private checkClients(step: number | "quiescence"): DstViolation | undefined {
+		for (const client of this.running) {
+			const expected = this.model.expected(client)
+			if (!expected) continue
+			const actual = this.todosOf(client)
+			if (JSON.stringify(actual) !== JSON.stringify(expected)) {
+				return { kind: "clientState", step, client, expected, actual }
+			}
+		}
+		return undefined
+	}
```

## 6. Finish: drain all calls, then check clients and server together

**Input:** the last step’s state, or a violation already found during the loop → **Output:** final client/server states and a violation if either side disagrees with the model

**Settle and reconnect before the final comparison**

```review-diff:dst/DstWorld.ts
@new:406	Release the gates and finish every in-flight call before judging the final state.
@new:422	Each client gets a final chance to receive the server’s state.
@new:427	The final check includes the server, so two matching clients cannot hide a wrong server state.
@new:428	Also flag writes that never reached the server.
--- PATCH ---
diff --git a/dst/DstWorld.ts b/dst/DstWorld.ts
new file mode 100644
--- /dev/null
+++ b/dst/DstWorld.ts
@@ -0,0 +401,29 @@
+	/**
+	 * Ends the run. Without a violation, restarts and reconnects every client and
+	 * checks the settled system; with one, only drains what is in flight.
+	 */
+	async finish(violation: DstViolation | undefined): Promise<DstOutcome> {
+		await this.drain()
+
+		if (!violation) {
+			for (const name of this.down) {
+				this.crashed.delete(name)
+				this.generations[name] += 1
+				await this.harness.restart(name)
+				await this.boot(name)
+			}
+			for (const name of this.unconnected) {
+				await (
+					await this.harness[name].connect()
+				).result
+			}
+			for (const name of clientNames) {
+				await (
+					await this.harness[name].pullFromRemote()
+				).result
+			}
+			violation =
+				this.checkClients("quiescence") ??
+				(await this.checkServer()) ??
+				this.checkAccepted()
+		}
```

**Compare the real server with the model**

```review-diff:dst/DstWorld.ts
@new:538	Read what the real server stored.
@new:539	Compare it with mutations the model observed the server accept.
--- PATCH ---
diff --git a/dst/DstWorld.ts b/dst/DstWorld.ts
new file mode 100644
--- /dev/null
+++ b/dst/DstWorld.ts
@@ -0,0 +537,6 @@
+	private async checkServer(): Promise<DstViolation | undefined> {
+		const actual = await this.serverTodos()
+		const expected = this.model.serverState()
+		if (JSON.stringify(actual) === JSON.stringify(expected)) return undefined
+		return { kind: "serverState", expected, actual }
+	}
```

## 7. If a failure is saved: replay feeds the same actions into a fresh world

**Input:** the recorded seed and event trace from an early or final violation → **Output:** the same violation, or the first point where replay diverges

**Replay one recorded step**

```review-diff:dst/DstReplay.ts
@new:99	Replay uses the saved choice instead of drawing a new random one.
@new:101	If that action is no longer possible, report divergence at this step.
@new:110	Apply the same intent to a fresh world.
@new:125	Run the same state check after the replayed action.
--- PATCH ---
diff --git a/dst/DstReplay.ts b/dst/DstReplay.ts
new file mode 100644
--- /dev/null
+++ b/dst/DstReplay.ts
@@ -0,0 +90,40 @@
+	await using world = await DstWorld.start(artifact.options.seed)
+	const events = new Map(artifact.trace.map((record) => [record.step, record]))
+	const steps =
+		artifact.outcome?.stepsCompleted ?? (artifact.trace.at(-1)?.step ?? -1) + 1
+
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
