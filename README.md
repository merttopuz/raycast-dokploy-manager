<p align="center">
  <img src="media/icon.png" width="128" alt="Dokploy for Raycast" />
</p>

<h1 align="center">Dokploy Manager for Raycast</h1>

<p align="center">
  Manage your <a href="https://dokploy.com">Dokploy</a> servers without leaving Raycast.
</p>

<p align="center">
  <a href="#getting-started">Getting started</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#ask-raycast-ai">Raycast AI</a> ·
  <a href="#your-data">Your data</a>
</p>

<p align="center">
  <img src="media/services.png" width="700" alt="Browsing the services of a Dokploy project in Raycast" />
</p>

Browse your projects, deploy and restart services, read logs, and find out why a build failed - all from the Raycast window. Connect as many Dokploy servers as you like and switch between them in a keystroke.

## Getting started

1. Open your Dokploy dashboard and go to **Settings → Profile → API/CLI**, then generate an API key.
2. In Raycast, run **Manage Accounts**, and add your server address together with that key.

<p align="center">
  <img src="media/setup.png" width="700" alt="Adding a Dokploy account in Raycast" />
</p>

That's it. Your key is checked against the server as you save it, so if something is wrong you'll know straight away rather than the next time you try to deploy.

Have more than one server? Add them all. Most commands act on the account you've marked as active, which you can change from **Manage Accounts** or from the dropdown in the search bar.

## Commands

**Browse Projects** - Walk through your projects and environments and act on any service inside them: applications, Docker Compose stacks, and PostgreSQL, MySQL, MariaDB, MongoDB, Redis and LibSQL databases.

**Search Services** - Every service on the server in one searchable list, when you know the name and don't want to click through projects.

**Recent Deployments** - What was deployed lately, whether it worked, and the build log when it didn't. You can also kill a build that's stuck, cancel one that's queued, or roll back to an earlier build.

**Deploy Template** - Dokploy ships hundreds of ready-made Compose stacks: n8n, Plausible, Uptime Kuma, Supabase and the rest. Search them by name or by tag, then pick a project and environment and install one without touching the dashboard.

**Service Status** - A menu-bar item that keeps an eye on everything. It turns red the moment a service fails, so you find out without going looking. Deploy or restart anything from the menu, or jump into its deployments.

**Manage Accounts** - Add, edit, remove and switch between your Dokploy servers.

Projects and services put themselves in the order you actually use them: the service you deploy every day drifts to the top of the list, and the one you touched once in March sinks. If that ever guesses wrong, **Reset Ranking** puts an item back where it started.

## What you can do to a service

Deploy, redeploy, start, stop, reload and delete - plus read its logs, see its domains, and open it in the Dokploy dashboard. Databases can be rebuilt instead of redeployed, matching what Dokploy itself offers for each kind of service.

Anything that takes a service down asks you to confirm first.

### Environment variables

Any service's variables are one keystroke away (`⌘⇧E`), and editable in place. Values are masked until you press **Reveal Values**, because reading your own environment on your own machine isn't the risk - doing it while screen-sharing is, and that's exactly when you reach for Raycast.

Saving stores the variables but doesn't restart anything, the same as Dokploy itself: redeploy the service when you want them to take effect.

### Database connection strings

Postgres, MySQL, MariaDB, MongoDB, Redis and LibSQL each hand you a connection string straight to the clipboard:

- **External** (`⌘⇧U`) - the one you paste into TablePlus or `psql` on your laptop. Only exists once the database has an external port; if it doesn't have one, the extension says so rather than copying something that can't connect.
- **Internal** (`⌘⌥U`) - the one you paste into another service's environment variables, reaching the database over Dokploy's own network.

These are built to match what the Dokploy dashboard shows for each kind of database, quirks and all. Connection strings and passwords are copied as concealed, so they don't linger in Raycast's clipboard history.

## Ask Raycast AI

The extension works with Raycast AI, so you can just say what you want:

- "is anything down on Dokploy?"
- "why did the last deploy of the api fail?"
- "redeploy the storefront backend"
- "show me the last 50 log lines from the worker"

<p align="center">
  <img src="media/ai.png" width="700" alt="Asking Raycast AI whether any Dokploy service is down" />
</p>

Before anything is deployed, started, stopped or restarted, Raycast shows you exactly what is about to happen and waits for your approval. Deleting a service is not something the AI can do at all.

If a name is ambiguous - say two projects both have a service called `api` - you'll be asked which one you meant rather than have one picked for you.

## Settings

- **Log Lines** - how much of a log to fetch when you open one. Defaults to 200.
- **Watch** (Service Status) - whether the menu bar keeps an eye on every server you've connected or only the active one. Defaults to all of them.

## Your data

This extension talks to your own Dokploy server. There is no analytics, and nothing is sent anywhere else - with one exception, which is worth being precise about.

**Deploy Template** shows each template's logo, and those images are hosted on Dokploy's template registry at `templates.dokploy.com`, not on your server. Opening that command therefore fetches images from that host, which sees your IP address like any website you visit. Nothing about your server, your projects or your key is sent with those requests, and no other command touches it. If you never open **Deploy Template**, the extension only ever talks to your own server.

Your API keys are kept in Raycast's encrypted local storage, and never leave your machine except to sign requests to your own server. Environment variables, build secrets and database passwords are never shown to Raycast AI.

Secrets are also never written to disk. Raycast caches command results so lists open instantly, but that cache isn't encrypted - so environment variables and database credentials are fetched only when you ask to see them, kept in memory, and left out of the cache entirely. That's also why a database's credentials are read at the moment you copy them rather than when the list is drawn.

One thing worth knowing before you use the AI commands: whatever the AI reads on your behalf gets sent to Raycast AI so the model can answer you - including **log contents**, if you ask about them. Logs are your application's raw output, so if your app prints tokens or personal data, that goes along too. When that matters, use the regular commands instead, which keep everything on your machine.

## License

MIT
