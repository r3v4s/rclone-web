# Rclone Web Remote Access Guide

This guide explains how to run the web UI in Docker while using an rclone
installation that already exists on the host machine.

The examples assume the host machine IP is:

```text
192.168.0.1
```

## Why Docker Cannot See Host rclone Automatically

When the web UI runs inside Docker, `127.0.0.1` means the Docker container
itself, not the host machine.

So this does not work from a remote browser or from the container:

```text
http://127.0.0.1:5572
```

The rclone RC server must be reachable through an address that the browser can
open, such as:

```text
http://192.168.0.1:5572
```

## Recommended Setup

Run rclone RC directly on the host machine and bind it to all network
interfaces.

```bash
rclone rcd \
  --rc-addr 0.0.0.0:5572 \
  --rc-user dev \
  --rc-pass dev \
  --rc-allow-origin http://192.168.0.1:5173
```

Then run the web UI container and expose the Vite dev server port.

```bash
docker run --rm \
  -p 5173:5173 \
  -e RCLONE_BIN=/bin/true \
  rclone-web-dev \
  npm run dev -- --host 0.0.0.0
```

Open this URL from another browser or another PC on the same network:

```text
http://192.168.0.1:5173/login?url=http%3A%2F%2F192.168.0.1%3A5572&user=dev&pass=dev
```

After login, the UI connects to:

```text
http://192.168.0.1:5572
```

## Using a Custom Domain

When accessing the Vite dev server through a domain, Vite may block the request
unless the host is explicitly allowed.

Do not hard-code the domain in source code. Pass it at runtime instead:

```bash
RCLONE_WEB_ALLOWED_HOSTS=rc.example.com \
RCLONE_WEB_PUBLIC_ORIGIN=https://rc.example.com \
npm run dev -- --host 0.0.0.0
```

If you run the UI in Docker:

```bash
docker run --rm \
  -p 5173:5173 \
  -e RCLONE_BIN=/bin/true \
  -e RCLONE_WEB_ALLOWED_HOSTS=rc.example.com \
  -e RCLONE_WEB_PUBLIC_ORIGIN=https://rc.example.com \
  rclone-web-dev \
  npm run dev -- --host 0.0.0.0
```

If more than one host should be allowed, use a comma-separated list:

```bash
RCLONE_WEB_ALLOWED_HOSTS=rc.example.com,192.168.0.1,localhost \
npm run dev -- --host 0.0.0.0
```

When rclone RC is started separately, its allowed origin must match the public
UI origin:

```bash
rclone rcd \
  --rc-addr 0.0.0.0:5572 \
  --rc-user dev \
  --rc-pass dev \
  --rc-allow-origin https://rc.example.com
```

Use the domain-based login URL:

```text
https://rc.example.com/login?url=http%3A%2F%2F192.168.0.1%3A5572&user=dev&pass=dev
```

## If You See "URL is not configured"

That message means the login page does not have an rclone RC URL saved or
provided.

Use the full login URL:

```text
http://192.168.0.1:5173/login?url=http%3A%2F%2F192.168.0.1%3A5572&user=dev&pass=dev
```

Or enter this manually in the URL field on the login page:

```text
http://192.168.0.1:5572
```

Use these credentials if you followed the example above:

```text
user: dev
pass: dev
```

## Docker Desktop Alternative

On Docker Desktop, containers can often reach the host through:

```text
host.docker.internal
```

However, this app's browser client talks directly to rclone RC. That means the
URL must be reachable from the browser, not only from inside the container.

For that reason, this is usually better:

```text
http://192.168.0.1:5572
```

Use `host.docker.internal` only when the code running inside the container needs
to call the host directly.

## Linux Docker Host Name Option

If container-side access to the host is needed on Linux, add this Docker option:

```bash
--add-host=host.docker.internal:host-gateway
```

Example:

```bash
docker run --rm \
  -p 5173:5173 \
  --add-host=host.docker.internal:host-gateway \
  -e RCLONE_BIN=/bin/true \
  rclone-web-dev \
  npm run dev -- --host 0.0.0.0
```

Again, for browser login, prefer the browser-reachable host IP:

```text
http://192.168.0.1:5572
```

## Firewall Checklist

Make sure these ports are reachable from the client browser:

```text
5173  web UI
5572  rclone RC
```

On Linux with ufw:

```bash
sudo ufw allow 5173/tcp
sudo ufw allow 5572/tcp
```

On Windows, allow inbound TCP connections for ports `5173` and `5572` in
Windows Defender Firewall.

## Security Notes

Opening rclone RC on `0.0.0.0` exposes it to the network. Do this only on a
trusted LAN, VPN, or protected firewall environment.

Use a stronger username and password than the example:

```bash
rclone rcd \
  --rc-addr 0.0.0.0:5572 \
  --rc-user my-user \
  --rc-pass 'change-this-password' \
  --rc-allow-origin http://192.168.0.1:5173
```

Then update the login URL:

```text
http://192.168.0.1:5173/login?url=http%3A%2F%2F192.168.0.1%3A5572&user=my-user&pass=change-this-password
```

## Quick Test

From the browser machine, check that the UI opens:

```text
http://192.168.0.1:5173
```

Then check that rclone RC is reachable:

```bash
curl -u dev:dev http://192.168.0.1:5572/rc/noopauth
```

Expected response:

```json
{}
```

If this fails, the problem is usually one of these:

- rclone RC is still bound to `127.0.0.1` instead of `0.0.0.0`.
- Port `5572` is blocked by a firewall.
- The browser is using the wrong RC URL.
- `--rc-allow-origin` does not match the UI origin.
