# Partner pitch draft — A shared European avalanche observation layer

## Working proposition

Build a free, open-source European field-observation layer that sits **beside official avalanche warning services, not in competition with them**.

Europe already has highly capable national and regional avalanche warning services and shared EAWS standards. The missing layer is a consistent way for mountain users to submit useful, geolocated field observations — avalanche activity, snowpack, stability tests, weather and incidents — once, using a common schema, so the relevant warning service and the public can benefit from the same information.

The Pyrenees prototype demonstrates the idea across several warning jurisdictions. The long-term goal is not to create another forecasting authority. It is to make local observations interoperable across borders while keeping each official warning service authoritative for its own bulletin.

## Why this could help

Official bulletins necessarily describe conditions at a regional scale. Field conditions can vary substantially within a warning region, and warning services rely on observations from terrain to improve situational awareness. Today, useful public observations are fragmented across local forms, social media, messaging groups and private platforms.

A common open observation layer could:

- give forecasters additional structured observations from the field;
- give users local context beside the official bulletin without replacing it;
- reduce duplication by allowing one observation to be shared with the relevant service and public map;
- provide a common technical format for avalanche, snowpack, weather, stability-test and incident observations;
- preserve source, timestamp, location, uncertainty and verification status;
- make cross-border mountain ranges such as the Pyrenees and Alps easier to understand without flattening local forecasting expertise.

## Principles

**Official warnings remain authoritative.** The platform never produces or modifies the official danger rating unless that value comes from the responsible warning service.

**Open by default.** The reference implementation, observation schema and API should be openly documented and available for warning services to adopt, host or integrate without licence fees.

**Interoperable rather than centralized.** A warning service should be able to consume observations through an API, publish its own data into the common layer, or run the software itself. The project should not require a single private platform to control European observation data.

**Provenance and uncertainty stay visible.** Community observations must be clearly distinguished from official or verified information. Time, source, location, editing history and verification state should travel with the data.

**Privacy and safety by design.** Serious accidents, suspected fatalities, personal information and sensitive rescue information need stricter handling than ordinary snow or avalanche observations.

## Proposed pilot

Use the Pyrenees as a cross-border pilot with ICGC, Val d'Aran/Lauegi, AEMET, Meteo.ad and Météo-France.

The first pilot would focus on a small, agreed observation schema and two-way interoperability:

1. The public can submit a structured observation from the map or phone.
2. The observation is routed to the responsible warning-service region.
3. The warning service can retrieve it through a documented API/feed.
4. The public map displays it as community information with clear provenance and verification status.
5. Services can optionally confirm, flag, hide or enrich observations without changing the original record silently.

## What we would ask from a warning service

We are not asking a warning service to replace its existing bulletin or website. We would initially ask for:

- one forecaster or technical contact to review which observation fields are genuinely useful;
- feedback on privacy, moderation and incident-reporting requirements;
- permission to use stable warning-region identifiers and public bulletin links/data where available;
- a small technical pilot in which observations can be exported to the service in an agreed format.

## What we would contribute

- an open-source reference web/mobile interface;
- a versioned observation JSON schema;
- documented REST/GeoJSON/OpenAPI endpoints;
- cross-border region routing;
- multilingual user interface;
- community-marker visualization and provenance rules;
- a neutral adapter layer so each service can keep its own internal systems;
- documentation, tests and deployment examples.

## Long-term outcome

The strongest outcome would not be one new European avalanche website. It would be a **shared European observation standard and open implementation** that any warning service can use directly, while existing official bulletins and local expertise remain in place.

A user could then submit a useful observation once, and the responsible warning service could receive it immediately in a structured form. That creates a closer connection between users and forecasters rather than another private information silo.

## Suggested first ask

> Would you be willing to review a working Pyrenees prototype and help us define a small, open field-observation schema that would be genuinely useful to your forecasters? We are specifically looking for technical and operational feedback, not endorsement of a new forecasting service.
