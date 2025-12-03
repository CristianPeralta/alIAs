# 📋 GLOBAL REPORT – "AlIAs" ARCHITECTURE  
*(Complete analysis: characteristics, -ilities, components, and ADRs)*

---

## 1. DOCUMENT OBJECTIVE  
Present in a **single, comprehensive document** all architectural decisions made for the AlIAs system (unified people search in Peru), justifying their selection in the context of:  
- Mobile user (latency < 5s).  
- No authentication.  
- External sources prone to changes and blocks.  
- Limited budget (≈ 15 USD/month).  

---

## 2. FEATURE SUMMARY (System Characteristics)  
1. **Intermediary** – does not store personal data.  
2. **Multi-source** – integrate ≥ 3 sources without affecting existing ones.  
3. **Maintainability** – sources change rules/HTML; must be trivial to add/remove.  
4. **Resilience** – if one fails, others continue.  
5. **Response unification** – same JSON format regardless of provider.  
6. **Performance** – target 2s, limit 5s.  
7. **Stateless** – no sessions or state between requests.  
8. **Hot configuration** – enable/disable sources via parameter.  

---

## 3. -ILITIES ORDERED BY PRIORITY  
1. Maintainability  
2. Resilience  
3. Performance (latency)  
4. Scalability (1 → 100 req/s)  
5. Basic security (validation, rate-limit)  
6. Observability (health, logs)  
7. Cost-effectiveness  
8. Extensibility  
9. Testability  
10. Deployability (Primary VPS, serverless optional)  

---

## 4. RESULTING ARCHITECTURAL STYLE  
- **Deployment**: VPS + Docker-compose (Node 20 + Redis + Nginx).  
- **Communication**: Synchronous HTTP, parallel from frontend.  
- **Patterns**: Adapter, Cache-Aside, Circuit-Breaker, Internal API Gateway, IP Rate-Limit.  
- **Frontend**: Vanilla/JS that orchestrates calls and renders results in order of arrival.  
- **Backend**: Set of stateless endpoints exposing adapters.  

---

## 5. LOGICAL COMPONENTS AND RESPONSIBILITIES  
1. **Internal API Gateway** – single entry point, CORS, rate-limit.  
2. **Input Validator** – DNI 8 digits, names ≤ 100 chars.  
3. **Source Adapter** – 1 per source, implements common interface.  
4. **Cache (Redis)** – cache-aside, TTL per source.  
5. **Circuit-Breaker (Redis)** – `cb:<source>` flag, 5 min TTL.  
6. **Health-Check** – exposes source status for UI.  
7. **Variant Generator (AI)** – separate endpoint, 7-day cache.  
8. **Normalizer** – always returns `{dni, firstName, lastName, motherLastName, source}`.  

---

## 6. RATIONALE BEHIND KEY DECISIONS  

| Key Point | Discarded Alternatives | Reason for Choice |  
|-----------|------------------------|-------------------|  
| VPS over serverless | Cold-start and 10-30s timeout | Predictable latency < 1s, no duration limit |  
| Redis vs local memory | Loses state on reboot | Need shared circuit-breaker and 60% hit-ratio |  
| Frontend orchestration | Single slow endpoint | Better perceived performance (cards appear progressively) |  
| No auth | JWT/api-key friction | Public MVP; IP rate-limiting sufficient for now |  
| Manual adapter registration | Magic auto-discovery | Tree-shaking and explicit compilation, avoids surprises |  

---

## 7. PHYSICAL ARCHITECTURE (simplified diagram)  

```
┌──────────────┐     HTTPS      ┌──────────────┐
│   User       │ ◄────────────► │   Nginx      │  rate-limit 60/IP
│ (mobile)     │                │  (TLS 1.3)   │
└──────┬───────┘                └──────┬───────┘
       │                               │
       ▼                               ▼
  JS Orchestration              API Gateway (Express)
  (parallel)                           │
       │                               ├─ /api/sources/sunat
       │                               ├─ /api/sources/reniec
       │                               ├─ /api/sources/jne
       │                               ├─ /api/generate-names
       │                               └─ /api/health
       │                                ▲ │
       ▼                                │ ▼
  Promises                           Redis (local)
  (results streaming)                cache + cb flags
```

---

## 8. COMPLETE ADRs (unabridged)  

### ADR-001 – VPS as Primary Platform  

### ADR-002 – Redis for Caching and Circuit-Breaker  

### ADR-003 – Client-Side Orchestration  

### ADR-004 – Per-Source Adapter and Manual Registration  

### ADR-005 – No Authentication, IP-Based Rate-Limiting  

### ADR-006 – AI-Generated Name Variant Caching  

### ADR-007 – Health-Check and Circuit-Breaker Strategy  
*See ADR details in [ADRs.md](./ADRs.md)*

---

## 9. METRICS AND NUMERICAL TARGETS  
- Latency: 95th p < 5s, target 2s.  
- External availability (UptimeRobot) ≥ 99%.  
- Cache hit-ratio ≥ 60%.  
- AI-variants cache hit-ratio ≥ 30%.  
- Infrastructure cost ≤ 15 USD/month (VPS 1 vCPU + 2 GB RAM).  

---

## 10. NEXT STEPS / SUGGESTED TIMELINE  
1. Implement ADR-004 → create 1st adapter (simplest one).  
2. Set up Docker stack (ADR-001) + Redis (ADR-002).  
3. Build health-check and circuit-breaker (ADR-007).  
4. Develop minimal UI with parallel orchestration (ADR-003).  
5. Add rate-limiting and validation (ADR-005).  
6. Integrate name generator + cache (ADR-006).  
7. Load testing + TTL and timeouts adjustment.  

---

## 11. PRODUCTION CHECKLIST  
✔ Dockerfile + compose working  
✔ CI with `npm audit` and adapter unit tests  
✔ Automatic SSL (certbot)  
✔ Daily Redis backups  
✔ UptimeRobot alerts + Telegram/Slack WebHook  
✔ Swagger/ReDoc endpoint documentation  

With this, the **complete cycle** of architectural definition according to Mark Richards is closed: characteristics, -ilities, logical components, and **all** decisions documented in ADRs.
