# OpenClaw Prebuilt Upstream

An **OpenAI Chat Completions-compatible** mock server built with **NestJS**. It
returns *prebuilt* responses selected by configurable matching rules, with full
support for streaming (SSE) and non-streaming responses. Drop it in as an
upstream endpoint for **OpenClaw Gateway** or any OpenAI-compatible client.

## Features

- `POST /v1/chat/completions` — OpenAI-compatible, streaming **and** non-streaming
- Rule-based responses (`contains` / `regex`), case-insensitive, **first match wins**
- **Hot-reload**: edit `responses.json` and rules reload with no restart
- Configurable inter-chunk streaming delay and chunk size
- Markdown- and code-block-aware chunking (`StreamService`)
- `GET /health` liveness endpoint
- Structured logging via the NestJS `Logger`
- Docker / Docker Compose ready
- Strongly typed, all config via `ConfigModule` — **no hardcoded values**

## Requirements

- Node.js 20+ (for local development)
- Docker (optional, for containerised runs)

## Quick start (local)

```bash
npm install
cp .env.example .env      # then tweak values as needed
npm run start:dev
```

> **Tip:** the spec default `STREAM_DELAY_MS=30000` is 30 seconds per chunk.
> For interactive testing, set `STREAM_DELAY_MS=50` in your `.env`.

## Quick start (Docker)

```bash
docker compose up
```

Override config inline:

```bash
STREAM_DELAY_MS=50 docker compose up --build
```

## Configuration

All configuration is read from environment variables via `ConfigModule`.

| Variable            | Default                      | Description                                        |
| ------------------- | ---------------------------- | -------------------------------------------------- |
| `PORT`              | `3000`                       | HTTP listen port                                   |
| `STREAM_DELAY_MS`   | `30000`                      | Delay between streamed chunks (ms)                 |
| `STREAM_CHUNK_SIZE` | `100`                        | Max characters per chunk (non-code paragraphs)     |
| `DEFAULT_RESPONSE`  | `No matching response found.`| Returned when no rule matches                      |
| `RESPONSES_FILE`    | `./responses.json`           | Path to the rules file (hot-reloaded)              |
| `LOG_REQUESTS`      | `true`                       | Log incoming requests                              |

## Response rules

Rules live in the file pointed to by `RESPONSES_FILE` (default `responses.json`):

```json
[
  {
    "id": "python-transactions",
    "type": "contains",
    "value": "transaction records",
    "response": "..."
  },
  {
    "id": "refund-policy",
    "type": "regex",
    "value": "(refund|money back)",
    "response": "..."
  }
]
```

- `type`: `contains` (substring) or `regex` (JS regular expression)
- Matching is **case-insensitive** and evaluated against the **last user message**
- **First matching rule wins**; if none match, `DEFAULT_RESPONSE` is returned
- Saving the file triggers an automatic reload:
  `Responses reloaded from responses.json`
- A malformed save is logged and ignored — the previously loaded rules stay active

## API

### `POST /v1/chat/completions`

Request:

```json
{
  "model": "prebuilt",
  "messages": [{ "role": "user", "content": "Tell me about transaction records" }],
  "stream": true
}
```

**Non-streaming** (`stream: false` or omitted) returns a standard
`chat.completion` object. **Streaming** (`stream: true`) returns
`text/event-stream` with `chat.completion.chunk` events, terminated by:

```text
data: [DONE]
```

### `GET /health`

```json
{ "status": "ok", "uptime": 123.45 }
```

## Example requests

Non-streaming:

```bash
curl -s http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"prebuilt","messages":[{"role":"user","content":"refund please"}]}' | jq
```

Streaming (set a small `STREAM_DELAY_MS` first):

```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"prebuilt","messages":[{"role":"user","content":"hello"}],"stream":true}'
```

Health:

```bash
curl -s http://localhost:3000/health | jq
```

## Project structure

```text
src/
  main.ts                                  # bootstrap + global validation
  app.module.ts                            # module wiring
  config/configuration.ts                  # typed env config (ConfigModule)
  chat/
    chat.controller.ts                     # POST /v1/chat/completions
    chat.service.ts                        # OpenAI payload + streaming logic
    dto/chat-completion.dto.ts             # class-validator DTOs
  responses/
    responses.service.ts                   # rule loading, matching, hot-reload
    interfaces/response-rule.interface.ts  # rule type
  stream/
    stream.service.ts                      # markdown/code-aware chunking
  health/
    health.controller.ts                   # GET /health
responses.json                             # response rules (hot-reloaded)
.env.example                               # configuration template
Dockerfile / docker-compose.yml           # container support
```

## Logging

The server logs incoming requests, the matched rule id, stream start/completion,
rule reloads, and errors via the NestJS `Logger`.

## License

MIT
