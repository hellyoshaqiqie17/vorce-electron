# VORCE Electron

Repository for VORCE desktop applications built with Electron.

## Modules

### [electron-agent](./electron-agent)

Desktop monitoring agent that runs on user devices, collects lightweight
device and activity telemetry, and ships it to the VORCE backend.

See [`electron-agent/README.md`](./electron-agent/README.md) for full
documentation, setup instructions, and architecture details.

## Architecture

```
Electron Agent  -->  VORCE Backend API  -->  Firestore
```

The agent **never** talks to Firestore directly. All data persistence
is handled by the backend after validating the bearer token and resolving
the authenticated user and company context.
