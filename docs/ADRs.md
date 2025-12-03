# ADR-001: VPS as Primary Deployment Platform  
**Status:** Proposed  
**Date:** 2025-12-04  

## 1. Context and Problems We Solve  
- The product will be used 99% from mobile devices; perceived latency must be < 5s at 95th percentile.  
- Serverless (Vercel, Netlify, etc.) introduces cold-start (300ms-2s) and hard-timeout (10-30s); if a source becomes slow (10s), we'd exceed the limit and the request would fail, breaking the "respond even if partial" promise.  
- We don't have a Site Reliability team; we need predictable costs (< 15 USD/month) and simple logs.  
- Sources are external and uncontrolled; we want to be able to cache and rate-limit without depending on external layers.  

## 2. Considered Options  
| Option | Pros | Cons |  
|--------|------|------|  
| A. Serverless functions (Vercel) | Auto-scaling, $0 up to 100k req/day | Cold-start, 10s timeout, impossible to maintain circuit-breaker state between invocations without external Redis |  
| B. Container on own VPS (Docker-compose) | No platform timeout, stable latency, Redis/Node stack in same internal network | Must monitor uptime, apply patches, manage SSL |  
| C. Managed Kubernetes | Native high availability | Overkill for max 100 req/s; cost 50-70 USD/month |  

## 3. Decision  
We choose **B** as the **primary platform**.  
- Official Node 20 + Alpine Docker image.  
- `docker-compose.yml` with three services: `nginx` (reverse-proxy + SSL via Let's Encrypt), `app` (Node), `redis`.  
- `/deploy/serverless` folder is maintained for the community, but **is not part of the critical production path**.  

## 4. Decision Implications  

### Positive  
- Latency 50-90ms to container; no cold-start.  
- Can adjust `ulimit`, Redis pool size, Node timeouts without platform limits.  
- Share Redis between replicas if scaling horizontally in the future (`swarm` or `k3s` mode).  

### Negative  
- Full uptime responsibility: if VPS goes down, service goes down.  
- Must implement: nightly Redis backups, alerts (Prometheus or at least UptimeRobot), automatic SSL cert renewal.  
- Fixed cost even with low traffic (3-5 USD/month VPS + 2 USD backup space).  

## 5. Acceptance Criteria  
- Dockerfile builds in < 3 min.  
- `docker-compose up -d` starts stack in < 30s.  
- External health-check (UptimeRobot) must show > 99% uptime over 30 days before production.  

## 6. Unblocked Dependencies  
- ADR-002 (Redis)  
- ADR-003 (client orchestration)  

---

# ADR-002: Redis for Response Caching and Circuit-Breaker  
**Status:** Proposed  
**Date:** 2025-12-04  

## 1. Context  
- "Sunat" source takes 2-4s and allows very few calls before triggering captcha.  
- Average user repeats same query 2.3 times in 10 min (internal validation).  
- If a source fails, we don't want to retry for the next 5 min.  

## 2. Impacted Quality Attributes  
- Performance (latency)  
- Resilience  
- Cost (reduce scraping)  

## 3. Evaluated Alternatives  
| Alternative | Advantages | Disadvantages |  
|-------------|------------|---------------|  
| 1. Internal memory-cache (Map) | Zero latency, no extra service | Loses state on container restart; impossible with replicas |  
| 2. Local Redis in container | Configurable persistence, native TTL, available for replicas | +1 service to monitor |  
| 3. Persistent SQL/NoSQL database | Survives deploys | Over-engineering; latency 10-20ms vs 0.5ms Redis |  

**Decision:** Option 2.  

## 4. Key Schema and TTL  
```
cache:<source>:<dni>  → Source TTL (e.g., 86400s Sunat, 604800 JNE)  
cb:<source>           → 300s TTL (circuit-breaker OPEN)  
ia:variants:<hash>    → 604800s TTL (AI-generated name variants)  
```

## 5. Policies  
- **Cache-aside (lazy)**: write only on miss.  
- **Don't cache errors** (4xx/5xx).  
- **Configurable TTL** via `TTL_<SOURCE>_SEC` env var.  

## 6. Risks and Mitigations  
- **Redis full** → configure `maxmemory 200mb` and `allkeys-lru` policy.  
- **Redis down** → `REDIS_OPTIONAL=true` flag; if no response, continue without cache (graceful degradation).  

## 7. Success Metrics  
- Hit-ratio > 60% in first 2 weeks.  
- 40% reduction in actual external source calls.  

---

# ADR-003: Client-Side Search Orchestration  
**Status:** Proposed  
**Date:** 2025-12-04  

## 1. Problem  
- We want to show results **as soon as each source responds** and in **order of arrival** (< 2s ideal).  
- Backend is stateless and doesn't use WebSockets to maintain simplicity.  

## 2. Options  
| Option | Description | Pros | Cons |  
|--------|-------------|------|------|  
| A. Single `/api/search` endpoint that orchestrates in backend | Fewer CORS, centralized logic | Latency = max(slowest source), more parallelization code in Node |  
| B. Frontend calls each `/api/sources/<slug>` in parallel | Result streaming, better perceived latency | More HTTP requests (1 per source) |  

**Decision:** Option B.  

## 3. Implementation Details  
```javascript
const sources = ['sunat','jne','reniec']; // get from /api/health
Promise.allSettled(
  sources.map(s => fetch(`/api/sources/${s}?dni=${dni}`))
).then(results => results.forEach((r, idx) => {
   if (r.status === 'fulfilled' && r.value.ok)
      renderCard(await r.value.json());
}));
```
- Fetch timeout: 5s.  
- If status = rejected or 5xx, show "Source unavailable" badge.  

## 4. Security Implications  
- No authentication → implement **IP-based rate-limit** in nginx (ADR-005).  
- CORS: `Access-Control-Allow-Origin: *` while there are no sessions.  

## 5. Scalability  
- Nginx maintains 1024 worker-connections by default; requests are short-lived.  
- If we switch to WebSocket or Server-Sent-Events in the future, this ADR will be reviewed.  

## 6. Acceptance Criteria  
- Lighthouse Time-to-Interactive ≤ 3s on 4G.  
- User sees first result ≤ 2s in 90% of tests with 3 sources.  

---

# ADR-004: Per-Source Adapter and Manual Registration  
**Status:** Proposed  
**Date:** 2025-12-04  

## 1. Objective  
Add/remove sources without touching business logic.  

## 2. Adapter Contract (TypeScript)  
```typescript
export interface SourceAdapter {
  name: string;                           // unique slug
  queryByDni(dni: string): Promise<Person>;
  queryByName(firstName: string, lastName: string, motherLastName: string): Promise<Person[]>;
  healthy(): Promise<boolean>;            // quick smoke-test
}
```
**Common return type**  
```typescript
type Person = {
  dni: string;
  firstName: string;
  lastName: string;
  motherLastName: string;
  source: string;        // same as name
}
```

## 3. Registration  
File `src/sources/index.ts`  
```typescript
export const adapters: SourceAdapter[] = [
  new SunatAdapter(),
  new ReniecAdapter(),
  new JneAdapter(),
];
```
- To add a source = create class + import in array.  
- No auto-discovery to avoid magic imports and enable tree-shaking.  

## 4. Pattern References  
- **Adapter** (GoF) – encapsulates specific details.  
- **Strategy** – orchestrator iterates over list without knowing implementations.  

## 5. Implementation Guidelines  
- Adapter internal timeout ≤ 5s.  
- Must catch any exception and translate to `SourceError` for circuit-breaker.  
- No state allowed between calls (stateless).  

## 6. Risk and Mitigation  
- **Forgetting to register** → integration test that iterates `adapters` and verifies slug appears in `/api/health`.  

---

# ADR-005: No Authentication, IP-Based Rate-Limiting  
**Status:** Proposed  
**Date:** 2025-12-04  

## 1. Context  
- End user = general public; flow must be registration-free.  
- We must protect external sources and our VPS from abuse.  

## 2. Alternatives  
| Alternative | Advantages | Disadvantages |  
|-------------|------------|---------------|  
| JWT + login | Full control | User friction; password recovery |  
| Simple API-Key | Easy to implement | Need to distribute it; can leak |  
| IP-based rate-limit (nginx) | Transparent, no code | May affect multiple users behind NAT |  

**Decision:** Option 3, limit **60 req/IP/minute** with burst of 10.  

## 3. Nginx Configuration (excerpt)
```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=60r/m;
limit_req zone=api burst=10 nodelay;
```
- Returns **429 Too Many Requests** if exceeded.  
- Doesn't block permanently; resets every minute.  

## 4. CORS  
- `Access-Control-Allow-Origin: *`  
- Allowed methods: `POST, GET, OPTIONS`  
- Headers: `Content-Type`  

## 5. Input Validation  
- DNI: 8 numeric digits (PE).  
- Names: length ≤ 100 chars, HTML-escaped.  
- If validation fails, **400 Bad Request** without reaching adapters.  

## 6. Audit and Future Evolution  
- For now, **we don't store IPs** (privacy).  
- When adding analytics, we'll anonymize (/24).  

## 7. Acceptance Criteria  
- `ab -n 100 -c 10` from same IP → ≤ 60 successful requests, rest 429.  
- 429 response arrives in < 10ms (doesn't touch Node).  

---

# ADR-006: AI-Generated Name Variants Caching Policy  
**Status:** Proposed  
**Date:** 2025-12-04  

## 1. Context  
- The `/api/generate-names` endpoint consumes AI tokens (≈ 0.30 USD per 1k calls).  
- Average user repeats 40% of queries within a week.  

## 2. Decision  
- Cache in Redis with key `ia:variants:<hash(normalized-name)>` and TTL = 7 days.  
- Before calling AI, check Redis; return directly on hit.  
- TTL configurable via `CACHE_IA_VARIANTS_TTL_SEC` (default 604800).  

## 3. Implications  
- Reduces AI costs by ~35%.  
- If we change AI engine or prompt, force invalidation with `redis-cli --pattern ia:variants*`.  

## 4. Success Metric  
- Hit-ratio ≥ 30% in first 30 days.  

---

# ADR-007: Source Health-Check and Circuit-Breaker Strategy  
**Status:** Proposed  
**Date:** 2025-12-04  

## 1. Objectives  
- Don't waste time on sources that are down or triggered anti-bot.  
- Allow frontend to hide or disable sources without manual intervention.  

## 2. Source States  
- **UP** → healthy() returns 200 and latency < 5s.  
- **DOWN** → circuit-breaker OPEN (key `cb:<source>` exists).  
- **UNKNOWN** → first start or transient error.  

## 3. Flow  
1. Before each real call, adapter checks `exists cb:<source>`.  
2. If exists → throws `SourceNotAvailable` that frontend shows as "Source temporarily disabled".  
3. Public health-check `/api/health` returns:  
   ```json
   {"sunat":"UP","jne":"DOWN","reniec":"UP"}
   ```  
   Client can decide to show/hide toggles.  

## 4. Reopening (half-open)  
- After circuit-breaker TTL expires (300s), allow **1 real request**.  
- If success → delete key; if fail → close again for another cycle.  

## 5. Risks  
- False positive due to temporary spike → 5 min degradation; acceptable per internal SLA < 1% requests.  

---

# Security – Quick Note (not ADR, but checklist)  
- Dockerfile: non-root user, `node:20-alpine` image, `npm ci --omit=dev`.  
- Sensitive env vars (`REDIS_URL`, `GOOGLE_API_KEY`) passed via `.env` file with 600 permissions.  
- Nginx: hide version, disable TRACE, TLS 1.3 only.  
- Dependencies: `npm audit` in CI; critical updates < 7 days.
