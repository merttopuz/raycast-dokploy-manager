# Dokploy Manager Changelog

## [Initial Version] - 2026-07-17

- Connect multiple Dokploy servers and switch between them from any command
- Browse projects, environments and their services, and create or delete a project
- Search every application, Compose stack and database in one list
- Deploy, redeploy, rebuild, start, stop, reload and delete services
- Deploy a service by name straight from Raycast's root search, without opening a window
- Read service logs and follow them live, picking which container of a Compose stack to read
- View service details and jump straight into the Dokploy dashboard
- Manage a service's domains: add, remove, generate one that already resolves to the server, and check DNS before saving
- Run a service's backups on demand, and see when each last ran
- Run a service's cron schedules on demand and read what they printed
- Build history per service: deployments, build logs, kill a running build, cancel a queued one, and roll back to an earlier build
- Copy a database's connection string, internal or external, without opening the dashboard
- View and edit any service's environment variables, build arguments and build secrets, with values masked until you ask for them
- Browse Dokploy's ready-made Compose templates, preview what one will create before installing it, and bookmark the ones you use
- Projects and services sort themselves by what you use most
- Menu-bar item showing service health across every connected server, turning red when something fails
- Watch server disk, CPU and memory from the menu bar, and run Docker's prune commands when the disk fills up
- Ask Raycast AI what's down, why a deploy failed, or to deploy a service for you
