# @canvas-one/commands

Headless command registration and execution. Hosts own each registry instance and dispose feature registrations on teardown. Metadata is JSON-safe, copied at registration and discovery; registration identifiers cannot collide. Each definition validates its unknown input and checks live availability immediately before execution. Pass a cancellation signal through execution context; handlers must cooperate with cancellation during ongoing work. Completed side effects are never rolled back by an abort result. Errors have typed codes; handler errors retain their original identity.

Build: `npm run build --workspace @canvas-one/commands`. Package exports consume emitted ESM and declarations, with no React, DOM, storage or domain dependencies.

The current workspace delegates actual command execution to `executeAvailable`, retaining its exhaustive product payloads and handlers. Product command definitions and F2 Quick options presentation remain in the app until their domain owners move. This phase does not add Cmd+K or authorize agents through discovery.
