# ABESS panel/mobile synchronization policy

This project uses two repositories:

- `abesskamer237/AbessVpn-Server-Panel`: control panel/API.
- `abesskamer237/AbessVpn-Mobile-App`: mobile management application.

## Project rule

Whenever a panel/API feature is added, changed, renamed, or fixed and that change affects mobile management, the corresponding mobile types, API calls, screens, labels, validation and release build must be updated in the same work session.

Do not leave a panel feature available only on the web when it is relevant to mobile administration.

## Frozen VPN engine

The currently working VPS/VPN data plane is considered frozen. Do not modify, replace, restart, or redesign the VPN engine as part of ordinary panel/mobile feature work unless the owner explicitly asks for a VPN-engine change.

Observability or management features should be implemented around the working engine without changing its forwarding behavior whenever possible.
