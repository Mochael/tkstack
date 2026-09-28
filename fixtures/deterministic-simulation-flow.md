# Deterministic simulation: two paths through one loop

This interactive example condenses two recorded runs from [Tandem's deterministic simulation spec](https://www.diffmap.dev/tanishqkancharla/tandem/commit/eb7a3fa9e70adb73fb5b44b8a5baf2997bc78918/specs/deterministic-simulation-testing.md). The values are selected milestones from the checked-in JSONL artifacts, rather than every scheduler event. Select a path, then step through it to see where the outcomes diverge.

From this fork's root, serve the file with a Tandem checkout as the source root. Then **View full code** opens the actual functions:

```sh
npm run cli -- serve fixtures/deterministic-simulation-flow.md --root tmp/tandem-source
```

```flow-examples
{
  "title": "What happens to client2's write?",
  "description": "The same seeded event loop follows a different path when a network handoff can be dropped.",
  "nodes": [
    { "id": "start", "label": "execute", "summary": "Start seeded world", "source": "[[dst/DstSimulation.ts#DstSimulation.execute]]" },
    { "id": "choose", "label": "choose", "summary": "Pick enabled event", "source": "[[dst/DstSimulation.ts#DstSimulation.choose]]" },
    { "id": "write", "label": "write", "summary": "Queue client mutation", "source": "[[dst/DstWorld.ts#DstWorld.write]]" },
    { "id": "pending", "label": "pending", "summary": "Read held calls", "source": "[[dst/DstWorld.ts#DstWorld.pending]]" },
    { "id": "advance", "label": "apply", "summary": "Release next boundary", "source": "[[dst/DstWorld.ts#DstWorld.apply]]" },
    { "id": "drop", "label": "apply", "summary": "Drop network request", "source": "[[dst/DstWorld.ts#DstWorld.apply]]" },
    { "id": "model", "label": "check", "summary": "Compare client to model", "source": "[[dst/DstWorld.ts#DstWorld.check]]" },
    { "id": "finish", "label": "finish", "summary": "Drain and compare", "source": "[[dst/DstWorld.ts#DstWorld.finish]]" }
  ],
  "cases": [
    {
      "id": "lost-push",
      "label": "Push request lost",
      "input": { "seed": 2, "steps": 10, "faultRate": 0.1 },
      "steps": [
        { "node": "start", "title": "Start a deterministic run", "detail": "The seed drives scheduler choices. Client IDs draw from separate seeded streams.", "input": { "seed": 2, "steps": 10, "faultRate": 0.1 }, "output": { "world": "two clients + server", "gates": "active" } },
        { "node": "choose", "title": "Step 0: draw a writer and ID", "detail": "rng.pick chooses index floor(0.704134 × 2) = 1, so client2 writes first. The next draw chooses item-1; 0.072546 < 0.2 selects remove. Item-1 is absent, so this operation changes no data but consumes three RNG draws.", "input": { "writers": ["client1", "client2"], "ids": ["item-1", "item-2", "item-3"], "rngDrawsApprox": [0.704134, 0.164842, 0.072546] }, "output": { "step": 0, "type": "remove", "client": "client2", "id": "item-1" } },
        { "node": "choose", "title": "Step 1: draw the next writer and ID", "detail": "The seeded stream continues after step 0. floor(0.593418 × 2) = 1 picks client2; floor(0.576623 × 3) = 1 picks item-2. The third draw is above the 0.2 remove threshold, so this is a set event.", "input": { "writers": ["client1", "client2"], "ids": ["item-1", "item-2", "item-3"], "rngDrawsApprox": [0.593418, 0.576623, 0.71599] }, "output": { "step": 1, "type": "set", "client": "client2", "id": "item-2" } },
        { "node": "write", "title": "Record an optimistic write", "detail": "The reference model keeps the write pending until a pull acknowledges it.", "input": { "id": "item-2", "text": "Note item-2 (rev 1)" }, "output": { "mutationId": "client2.0-1dn4lns", "pending": ["item-2"] } },
        { "node": "pending", "title": "Find a held sync tick", "detail": "Gatekeeper exposes the stopped call and its current sender and receiver.", "output": { "call": "client2.commit#1", "sentBy": "client2Timer", "waitingFor": "client2" } },
        { "node": "advance", "title": "Deliver the timer tick", "detail": "Step 2 advances the call to the server boundary; the mutation remains in flight.", "input": { "call": "client2.commit#1", "waitingFor": "client2" }, "output": { "call": "client2.commit#1", "waitingFor": "server" } },
        { "node": "choose", "title": "Choose a network fault", "detail": "Only network handoffs are eligible for a drop; timer and storage calls are excluded.", "input": { "faultRate": 0.1, "waitingFor": "server" }, "output": { "type": "drop", "call": "client2.commit#1" } },
        { "node": "drop", "title": "Drop the push request", "detail": "The server never sees the request. The current client incorrectly rolls back an optimistic write as though it was rejected.", "input": { "call": "client2.commit#1", "waitingFor": "server" }, "output": { "fault": "requestLost", "server": [], "client2": [] } },
        { "node": "model", "title": "Catch the mismatch at step 3", "detail": "The model still expects the write to remain pending. The runner stops at the first mismatch.", "input": { "expected": ["item-2"], "actual": [] }, "output": { "violation": "clientState", "step": 3 } }
      ],
      "result": { "violation": "clientState", "step": 3, "expected": ["item-2"], "actual": [] }
    },
    {
      "id": "empty-ack",
      "label": "Empty patch loses ack",
      "input": { "seed": 2, "steps": 30, "faultRate": 0 },
      "steps": [
        { "node": "start", "title": "Start without injected faults", "detail": "The run still explores overlapping operations, choosing one enabled event per step.", "input": { "seed": 2, "steps": 30, "faultRate": 0 }, "output": { "world": "two clients + server", "gates": "active" } },
        { "node": "choose", "title": "Step 0: choose a no-op remove", "detail": "The first three draws from seed 2 pick client2, item-1, then remove. Item-1 is absent. This still advances the scheduler's RNG state.", "input": { "writers": ["client1", "client2"], "rngDrawsApprox": [0.704134, 0.164842, 0.072546] }, "output": { "step": 0, "type": "remove", "client": "client2", "id": "item-1" } },
        { "node": "choose", "title": "Step 1: choose client2's set", "detail": "The next draws pick writer index 1 (client2), ID index 1 (item-2), then set because 0.71599 is above the remove threshold of 0.2.", "input": { "writers": ["client1", "client2"], "ids": ["item-1", "item-2", "item-3"], "rngDrawsApprox": [0.593418, 0.576623, 0.71599] }, "output": { "step": 1, "type": "set", "client": "client2", "id": "item-2" } },
        { "node": "write", "title": "Queue the set and remove", "detail": "The two operations eventually leave item-2 absent on the server.", "input": { "set": "item-2", "remove": "item-2" }, "output": { "server": [] } },
        { "node": "advance", "title": "Deliver an empty patch", "detail": "A later pull carries an acknowledgement but no changed records. The client returns before applying that ack, leaving its remove speculative.", "input": { "patch": [], "lastMutationId": "client2 remove" }, "output": { "client2Pending": ["remove item-2"] } },
        { "node": "choose", "title": "Choose client1's new set", "detail": "At step 29, client1 creates item-2 again with a newer value.", "output": { "type": "set", "client": "client1", "id": "item-2", "text": "Note item-2 (rev 29)" } },
        { "node": "model", "title": "Compare the settled states", "detail": "The old remove is replayed over the new server value, so client2 loses item-2.", "input": { "server": ["item-2 (rev 29)"], "client2": [] }, "output": { "expected": ["item-2 (rev 29)"], "actual": [] } },
        { "node": "finish", "title": "Report a quiescence violation", "detail": "The run drains gates, then compares every client and server against the model.", "output": { "violation": "clientState", "step": "quiescence", "client": "client2" } }
      ],
      "result": { "violation": "clientState", "step": "quiescence", "missing": "item-2 (rev 29)" }
    }
  ]
}
```

The graph stays at function level. Use **View full code** on a step to inspect the complete Tandem function in the source panel. The original [recordings and explanations](https://github.com/tanishqkancharla/tandem/tree/eb7a3fa9e70adb73fb5b44b8a5baf2997bc78918/dst/known-failures) contain the full event stream.
