# ADR-001: VPS como plataforma primaria de despliegue  
**Estado:** Propuesto  
**Fecha:** 2025-12-04  

## 1. Contexto y problemas que resolvemos  
- El producto se usará 99 % desde celulares; la latencia percibida debe ser < 5 s en 95º percentil.  
- Serverless (Vercel, Netlify, etc.) introduce *cold-start* (300 ms-2 s) y *hard-timeout* (10-30 s); si una fuente se pone lenta (10 s) superaríamos el límite y la petición moriría, rompiendo la promesa de "responde aunque sea parcial".  
- No tenemos equipo de *Site Reliability*; necesitamos costo predecible (< 15 USD/mes) y logs simples.  
- Las fuentes son externas y no controladas; queremos poder *cachear* y *rate-limitar* sin depender de capas externas.  

## 2. Opciones consideradas  
| Opción | Pros | Contras |  
|--------|------|---------|  
| A. Funciones serverless (Vercel) | Escalado automático, 0 USD hasta 100 k req/día | Cold-start, timeout 10 s, imposible mantener estado de circuit-breaker entre invocaciones sin Redis externo |  
| B. Contenedor en VPS propia (Docker-compose) | Sin timeout de plataforma, latencia estable, stack Redis/Node en la misma red interna | Debemos monitorear uptime, aplicar parches, gestionar SSL |  
| C. Kubernetes managed | Alta disponibilidad nativa | Overkill para 100 req/s máx.; costo 50-70 USD/mes |  

## 3. Decisión  
Elegimos **B** como **plataforma primaria**.  
- Imagen Docker oficial de Node 20 + Alpine.  
- `docker-compose.yml` con tres servicios: `nginx` (reverse-proxy + SSL vía Let's Encrypt), `app` (Node), `redis`.  
- Carpeta `/deploy/serverless` se mantiene para la comunidad, pero **no forma parte del path crítico de producción**.  

## 4. Implicaciones de la decisión  

### Positivas  
- Latencia 50-90 ms hasta el container; eliminamos cold-start.  
- Podemos ajustar `ulimit`, tamaño de pool de Redis, timeouts de Node sin límites de plataforma.  
- Compartimos Redis entre réplicas si en el futuro escala horizontal (modo `swarm` o `k3s`).  

### Negativas  
- Responsabilidad total del uptime: si cae VPS, cae el servicio.  
- Debemos implementar: backup nocturno de Redis, alertas (Prometheus o al menos UptimeRobot), renovación automática de cert SSL.  
- Costo fijo aunque el tráfico sea bajo (3-5 USD mes VPS + 2 USD backup space).  

## 5. Criterios de aceptación  
- Dockerfile construye en < 3 min.  
- `docker-compose up -d` levanta stack en < 30 s.  
- Health-check externo (UptimeRobot) debe dar > 99 % uptime en 30 días antes de pasar a producción.  

## 6. Dependencias que desbloquea  
- ADR-002 (Redis)  
- ADR-003 (orquestación en cliente)  

---

# ADR-002: Redis para cache de respuestas y circuit-breaker  
**Estado:** Propuesto  
**Fecha:** 2025-12-04  

## 1. Contexto  
- Fuente "Sunat" tarda 2-4 s y permite muy pocas llamadas antes de lanzar captcha.  
- Usuario promedio repite la misma consulta 2.3 veces en 10 min (validación interna previa).  
- Si una fuente cae, no queremos re-intentar durante los siguientes 5 min.  

## 2. Objetivos de calidad que impacta  
- Performance (latencia)  
- Resilience  
- Costo (reducir scraping)  

## 3. Alternativas evaluadas  
| Alternativa | Ventajas | Desventajas |  
|-------------|----------|-------------|  
| 1. Memory-cache interna (Map) | Cero latency, sin servicio extra | Pierde estado al reiniciar container; imposible en réplicas |  
| 2. Redis local en container | Persistencia configurable, TTL nativo, disponible para réplicas | +1 servicio a monitorear |  
| 3. Base SQL/NoSQL persistente | Duradero entre deploys | Over-engineering; latencia 10-20 ms vs 0.5 ms de Redis |  

**Decisión:** Opción 2.  

## 4. Esquema de claves y TTL  
```
cache:<fuente>:<dni>  → TTL fuente (ej. 86400 s Sunat, 604800 JNE)  
cb:<fuente>           → TTL 300 s (circuit-breaker OPEN)  
ia:variants:<hash>    → TTL 604800 s (variantes de nombres generadas por IA)  
```

## 5. Políticas  
- **Cache-aside (lazy)**: solo se escribe cuando hay *miss*.  
- **No cacheamos errores** (4xx/5xx).  
- **TTL configurable** vía variable de entorno `TTL_<FUENTE>_SEC`.  

## 6. Riesgos y mitigaciones  
- **Redis lleno** → configurar `maxmemory 200mb` y política `allkeys-lru`.  
- **Caída de Redis** → flag `REDIS_OPTIONAL=true`; si no responde, seguimos sin cache (caída *graceful*).  

## 7. Métricas de éxito  
- Hit-ratio > 60 % en las primeras 2 semanas.  
- Reducción 40 % del número de llamadas reales a fuentes externas.  

---

# ADR-003: Orquestación de búsquedas en el cliente (frontend)  
**Estado:** Propuesto  
**Fecha:** 2025-12-04  

## 1. Problema  
- Queremos mostrar resultados **tan pronto como cada fuente responda** y en **orden de llegada** (< 2 s ideal).  
- Backend stateless y sin WebSocket para mantener simplicidad.  

## 2. Opciones  
| Opción | Descripción | Pros | Contras |  
|--------|-------------|------|---------|  
| A. Endpoint único `/api/search` que orquesta en backend | Menos CORS, lógica centralizada | Latencia = max(fuente lenta), más código de paralelización en Node |  
| B. Frontend llama a cada `/api/fuentes/<slug>` en paralelo | Resultados *streaming*, latencia percibida baja | Más peticiones HTTP (1 por fuente) |  

**Decisión:** Opción B.  

## 3. Detalles de implementación  
```javascript
const fuentes = ['sunat','jne','reniec']; // los obtenemos de /api/health
Promise.allSettled(
  fuentes.map(f => fetch(`/api/fuentes/${f}?dni=${dni}`))
).then(results => results.forEach((r, idx) => {
   if (r.status === 'fulfilled' && r.value.ok)
      pintaCard(await r.value.json());
}));
```
- Timeout por fetch: 5 s.  
- Si status = *rejected* o 5xx, mostramos *badge* “Fuente no disponible”.  

## 4. Implicaciones de seguridad  
- Sin autenticación → implementaremos **rate-limit por IP** en nginx (ADR-005).  
- CORS: `Access-Control-Allow-Origin: *` mientras no haya sesiones.  

## 5. Escalabilidad  
- Nginx mantiene 1024 worker-connections por defecto; peticiones son cortas.  
- Si en el futuro pasamos a WebSocket o Server-Sent-Events, este ADR se revisa.  

## 6. Criterios de aceptación  
- Lighthouse *Time-to-Interactive* ≤ 3 s en 4G.  
- Usuario ve primer resultado ≤ 2 s en 90 % de pruebas con 3 fuentes.  

---

# ADR-004: Adaptador por fuente y registro manual  
**Estado:** Propuesto  
**Fecha:** 2025-12-04  

## 1. Objetivo  
Agregar/quitar fuentes sin tocar el núcleo de negocio.  

## 2. Contrato de adaptador (TypeScript)  
```typescript
export interface FuenteAdapter {
  nombre: string;                           // slug único
  consultarPorDni(dni: string): Promise<Persona>;
  consultarPorNombre(nombres: string, apPaterno: string, apMaterno: string): Promise<Persona[]>;
  healthy(): Promise<boolean>;               // smoke-test rápido
}
```
**Tipo de retorno común**  
```typescript
type Persona = {
  dni: string;
  nombres: string;
  apPaterno: string;
  apMaterno: string;
  fuente: string;        // mismo que nombre
}
```

## 3. Registro  
Archivo `src/fuentes/index.ts`  
```typescript
export const adapters: FuenteAdapter[] = [
  new SunatAdapter(),
  new ReniecAdapter(),
  new JneAdapter(),
];
```
- Añadir una fuente = crear clase + importar en el array.  
- No usamos auto-discovery para evitar *magic imports* y facilitar tree-shaking.  

## 4. Referencia a patrones  
- **Adapter** (GoF) – encapsula detalles específicos.  
- **Strategy** – el orquestador itera sobre la lista sin conocer implementaciones.  

## 5. Guías de implementación  
- Timeout interno del adaptador ≤ 5 s.  
- Debe capturar cualquier excepción y traducirla a `FuenteError` para que el circuit-breaker actúe.  
- No se permite *state* entre llamadas (stateless).  

## 6. Riesgo y mitigación  
- **Olvidarse de registrar** → test de integración que itere `adapters` y compruebe que el slug aparece en `/api/health`.  

---

# ADR-005: Sin autenticación, rate-limit por IP  
**Estado:** Propuesto  
**Fecha:** 2025-12-04  

## 1. Contexto  
- Usuario final = público general; flujo debe ser *sin registro*.  
- Debemos proteger las fuentes externas y nuestra VPS de abuso.  

## 2. Alternativas  
| Alternativa | Ventajas | Desventajas |  
|-------------|----------|-------------|  
| JWT + login | Control total | Fricción para usuario; olvido de passwords |  
| API-Key simple | Fácil de implementar | Hay que distribuirla; se filtra |  
| Rate-limit por IP (nginx) | Transparente, sin código | Puede afectar a múltiples usuarios detrás de NAT |  

**Decisión:** Opción 3, límite **60 req/IP/minuto** con *burst* de 10.  

## 3. Configuración nginx (extracto)
```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=60r/m;
limit_req zone=api burst=10 nodelay;
```
- Devuelve **429 Too Many Requests** si se supera.  
- No bloquea permanentemente; se resetea cada minuto.  

## 4. CORS  
- `Access-Control-Allow-Origin: *`  
- Métodos permitidos: `POST, GET, OPTIONS`  
- Headers: `Content-Type`  

## 5. Validación de entrada  
- DNI: 8 dígitos numéricos (PE).  
- Nombres: longitud ≤ 100 caracteres, se escapan con `he`.  
- Si falla, **400 Bad Request** sin llegar a adaptadores.  

## 6. Auditoría y evolución futura  
- Por ahora **no guardamos IPs** (privacidad).  
- Cuando agreguemos analytics, se anonimizará (/24).  

## 7. Criterios de aceptación  
- `ab -n 100 -c 10` desde misma IP → ≤ 60 requests exitosos, resto 429.  
- Respuesta 429 llega en < 10 ms (no toca Node).  


# ADR-006: Política de cacheo de nombres alternativos generados por IA  
**Estado:** Propuesto  

## 1. Contexto  
- El endpoint `/api/generate-names` consume tokens de IA (≈ 0.3 USD cada 1 k llamadas).  
- Usuario promedio repite 40 % de consultas en una semana.  

## 2. Decisión  
- Cache en Redis con clave `ia:variants:<hash(normalized-name)>` y TTL = 7 días.  
- Antes de llamar a IA se consulta Redis; si hay hit se devuelve directamente.  
- TTL configurable vía `CACHE_IA_VARIANTS_TTL_SEC` (default 604 800).  

## 3. Implicaciones  
- Reduce costo de IA en ~35 %.  
- Si cambiamos motor de IA o *prompt*, forzamos invalidación con `redis-cli --pattern ia:variants*`.  

## 4. Métrica de éxito  
- Hit-ratio ≥ 30 % en los primeros 30 días.  

---

# ADR-007: Estrategia de detección y desactivación de fuentes (health-check + circuit-breaker)  
**Estado:** Propuesto  

## 1. Objetivos  
- No gastar tiempo en fuentes que están caídas o han activado anti-bot.  
- Permitir que el frontend oculte o deshabilite fuentes sin intervención manual.  

## 2. Estados de una fuente  
- **UP** → healthy() responde 200 y latency < 5 s.  
- **DOWN** → circuit-breaker OPEN (clave `cb:<fuente>` existe).  
- **UNKNOWN** → primer arranque o error transitorio.  

## 3. Flujo  
1. Antes de cada llamada real el adaptador consulta `exists cb:<fuente>`.  
2. Si existe → lanza `FuenteNoDisponible` que el orquestador frontend mostrará como *“Fuente temporalmente deshabilitada”*.  
3. Health-check público `/api/health` devuelve:  
   ```json
   {"sunat":"UP","jne":"DOWN","reniec":"UP"}
   ```  
   El cliente puede decidir mostrar u ocultar switches.  

## 4. Reapertura (half-open)  
- Tras expirar TTL del circuit-breaker (300 s) se permite **1 petición real**.  
- Si éxito → se borra clave; si falla → se vuelve a cerrar por otro ciclo.  

## 5. Riesgos  
- Falso positivo por *spike* puntual → degradación 5 min; aceptable según SLA interno < 1 % requests.  

---

# Seguridad – Nota rápida (no ADR, pero checklist)  
- Dockerfile: usuario no-raíz, imagen `node:20-alpine`, `npm ci --omit=dev`.  
- Variables de entorno sensibles (`REDIS_URL`, `GOOGLE_API_KEY`) pasadas por archivo `.env` con permiso 600.  
- Nginx: ocultar versión, deshabilitar tokens trace, TLS 1.3 solo.  
- Dependencias: `npm audit` en CI; actualización crítica < 7 días.  
