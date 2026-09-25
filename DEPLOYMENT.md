# Acceso remoto (opcional)

RecallForge está pensado para usarse en tu propio ordenador: los agentes locales (Claude Code, Claude Desktop, Cursor, VS Code, Codex…) lo arrancan por stdio y la web solo escucha en `127.0.0.1`. No necesitas nada de esta guía para eso.

Solo hace falta si quieres usarlo desde un **agente en la nube** (conectores personalizados de Claude.ai o ChatGPT) o desde **otro dispositivo**.

## 1. Define un token

Con `RECALLFORGE_TOKEN` definido, la web, la API REST y el MCP por HTTP exigen ese token en cada petición:

```bash
export RECALLFORGE_TOKEN="$(openssl rand -hex 32)"
npm run build
node dist/cli.mjs ui
```

- Agentes: `Authorization: Bearer <token>` (o `X-API-Key: <token>`).
- Clientes que no permiten cabeceras (conectores de Claude.ai o ChatGPT): añade `?key=<token>` a la URL, por ejemplo `https://tu-tunel.example/api/mcp?key=<token>`.
- Navegador: abre la web una vez con `?key=<token>` y se guardará en una cookie.

## 2. Expón el puerto 3030 por HTTPS

Elige una opción:

- **Tailscale** (solo tus dispositivos): `tailscale serve 3030`. Para que llegue un servicio en la nube: `tailscale funnel 3030`.
- **Cloudflare Tunnel**: `cloudflared tunnel --url http://127.0.0.1:3030`.
- Un proxy inverso con certificado (Caddy, nginx).

Define `BASE_URL` con la dirección pública para que *Agentes y ajustes* muestre la configuración correcta.

## 3. Conecta el agente remoto

La URL del servidor MCP es `https://<tu-dirección>/api/mcp`, con el token en la cabecera o en `?key=`.

## Seguridad

- No expongas RecallForge **sin** `RECALLFORGE_TOKEN`: cualquiera con la URL podría leer y cambiar tus tarjetas.
- Si compartes el token por error, cambia su valor y reinicia la web.
- Las peticiones a la API tienen un límite (`RATE_LIMIT_API_MAX`, 120 por minuto por IP).
