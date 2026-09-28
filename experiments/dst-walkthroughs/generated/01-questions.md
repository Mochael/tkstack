# Deterministic simulation testing, explained through questions

## What problem is this code review solving?

The old `dst/` test created two Tandem clients and a server, but finished each mutation before starting the next. It therefore never tested what happens when two sync operations overlap. It also judged success by comparing the clients with each other, so both could miss a server write and still pass.

```callstack
 old simulation step
-├── start one client mutation
-└── finish its commit before starting another
 new simulation step [[dst/DstSimulation.ts#DstSimulation.execute]]
+├── choose one possible event [[dst/DstSimulation.ts#DstSimulation.choose]]
+└── apply it, then check the model [[dst/DstWorld.ts#DstWorld.apply]]
```

## What are the client and server in this test?

They are in-process instances of Tandem's real `TandemClient` and `TandemServer` classes, all using a small `todos` schema. Each client has its own local data and durable storage service. The server has separate in-memory storage. A client pushes its writes to the server and pulls other writes back; the server can also poke a client to prompt a pull.

## Why isn't starting both requests enough?

Starting both creates overlap, but leaves the order to normal asynchronous scheduling. This test needs to choose whether each request or reply advances or gets lost, then repeat that exact sequence later. Gatekeeper pauses calls at handoffs so the simulation can make those choices.

## What does one simulation step do now?

It may start a `set` or `remove`, advance one paused call, drop a network handoff, crash a client, or restart one. The seeded generator chooses among actions that are possible at that moment. A step does not wait for a whole commit to finish.

```callstack
 DstSimulation.execute [[dst/DstSimulation.ts#DstSimulation.execute]]
 ├── choose # mutation, advance, drop, crash, or restart [[dst/DstSimulation.ts#DstSimulation.choose]]
 ├── world.apply # perform only that event [[dst/DstWorld.ts#DstWorld.apply]]
 └── world.check # stop at the first model violation [[dst/DstWorld.ts#DstWorld.check]]
```

## Why must the loop know which calls are paused?

It can only advance or fail a call at its current Gatekeeper boundary. `pendingCalls()` supplies the actionable calls, their handles, and who is waiting for whom. Without that list, the loop cannot choose which request or reply to deliver next.

## Why does `pendingCalls()` report one entry per call?

A call can pass several boundaries over its lifetime, but only its current stop can be controlled. Reporting earlier stops would offer impossible actions. Calls already complete, cancelled, or currently running are omitted.

## How does the test keep the same seed reproducible?

The seed drives event choices and separate ID streams for the server and each client. Timer ticks also pass through Gatekeeper instead of real time. Separate streams matter because adding an ID generation inside a client should not silently change the event chooser's random sequence.

## Why did server pokes need special handling?

A poke starts new work on a client; it is not a reply to the server's current call. Previously its pull could run outside Gatekeeper, so the loop could not see or order it. Pokes became gated events that can be delivered or lost like other network handoffs.

## Which failures can the simulation inject?

It can drop network handoffs: a request before the server sees it, a reply after the server processes it, or a server poke. The chooser excludes local timer and storage handoffs, because those are not network messages. A lost reply is particularly tricky: the server may have stored a write while the client believes the push failed.

## What happens when a client crashes?

Gatekeeper cuts the old client instance off from other services and can build a new one. Its separate storage service survives, so the replacement loads the data previously written there. This tests whether a write that survived locally but had not reached the server is eventually sent after restart.

## How does the test decide whether the data is correct?

An independent `ReferenceModel` tracks server-accepted writes, the last server state each client received, and each client's unacknowledged local writes. After each step, a client's visible data should equal its received data with its pending writes applied. After all work settles, the server and clients are checked against the model.

## Why check after every step and again at the end?

While messages are in flight, clients may correctly disagree with each other. The per-step model check catches an incorrect local state at the first point it appears. At the end, the test drains pending work and checks whether all writes reached the server and all participants settled correctly.

## How can someone reproduce a failing run?

The runner writes a JSONL artifact containing the options, each chosen event, and the outcome. Replay applies those recorded events without making new random choices. This preserves the path even if a future code change alters how a seed chooses events.

## What regressions are already recorded?

Four known failures have replay artifacts: a lost acknowledgement, a server bookkeeping error for pushed keys, a push failure treated as rejection, and a stored write lost across a client crash. The tests require each recording to reach its documented violation; when a bug is fixed, the recording must be reviewed and updated or removed.

## Does every PR already run a PR-number seed?

No. The spec's Phase 9 still has unchecked tasks for a CLI, a PR workflow, and a nightly sweep. The intended PR check is a short seeded run plus fixed regression seeds, with a trace uploaded when it fails. The existing `dst/dst.spec.ts` runs selected seeds and replays known-failure artifacts.
