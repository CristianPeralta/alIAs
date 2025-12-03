# 📋 INFORME GLOBAL – ARQUITECTURA “AlIAs”  
*(Análisis completo: características, ‑ilities, componentes y ADRs)*

---

## 1. OBJETIVO DEL DOCUMENTO  
Presentar de forma **única y completa** todas las decisiones arquitectónicas adoptadas para el sistema AlIAs (buscador unificado de personas en Perú), justificando su elección en el contexto de:  
- Usuario móvil (latencia < 5 s).  
- Sin autenticación.  
- Fuentes externas propensas a cambios y bloqueos.  
- Presupuesto reducido (≈ 15 USD/mes).  

---

## 2. RESUMEN DE CARACTERÍSTICAS (System Characteristics)  
1. **Intermediario** – no almacena datos personales.  
2. **Multi-fuente** – integrar ≥ 3 fuentes sin afectar las existentes.  
3. **Mantenibilidad** – fuentes cambian reglas/HTML; debe ser trivial añadir/quitar.  
4. **Resilience** – si una cae, las demás continúan.  
5. **Unificación de respuesta** – mismo formato JSON independiente del proveedor.  
6. **Performance** – objetivo 2 s, límite 5 s.  
7. **Stateless** – sin sesiones ni estado entre requests.  
8. **Configurabilidad en caliente** – activar/desactivar fuentes vía parámetro.  

---

## 3. ‑ILITIES ORDENADAS POR PRIORIDAD  
1. Maintainability  
2. Resilience  
3. Performance (latencia)  
4. Scalability (1 → 100 req/s)  
5. Security básica (validación, rate-limit)  
6. Observability (health, logs)  
7. Cost-efectividad  
8. Extensibility  
9. Testability  
10. Deployability (VPS primaria, serverless opcional)  

---

## 4. ESTILO ARQUITECTÓNICO RESULTANTE  
- **Deployment**: VPS + Docker-compose (Node 20 + Redis + Nginx).  
- **Comunicación**: HTTP síncrono, paralelo desde frontend.  
- **Patrones**: Adapter, Cache-Aside, Circuit-Breaker, API Gateway interno, Rate-Limit IP.  
- **Frontend**: Vanilla/JS que orquesta llamadas y pinta resultados en orden de llegada.  
- **Backend**: Conjunto de endpoints stateless que exponen adaptadores.  

---

## 5. COMPONENTES LÓGICOS Y RESPONSABILIDADES  
1. **API Gateway interno** – entrada única, CORS, rate-limit.  
2. **Validador de entrada** – DNI 8 dígitos, nombres ≤ 100 char.  
3. **Adaptador de fuente** – 1 por fuente, implementa interfaz común.  
4. **Cache (Redis)** – *cache-aside*, TTL por fuente.  
5. **Circuit-Breaker (Redis)** – flag `cb:<fuente>`, TTL 5 min.  
6. **Health-Check** – expone estado por fuente para UI.  
7. **Generador de variantes (IA)** – endpoint aparte, cacheado 7 días.  
8. **Normalizador** – devuelve siempre `{dni, nombres, apPaterno, apMaterno, fuente}`.  

---

## 6. RELATO DE “POR QUÉ” SE ESCOGIERON LAS OPCIONES CLAVE  

| Punto clave | Alternativas descartadas | Razón de elección |  
|-------------|--------------------------|-------------------|  
| VPS en vez de serverless | Cold-start y timeout 10-30 s | Latencia predecible < 1 s, sin límite de duración |  
| Redis vs memoria local | Pierde estado en reboot | Necesitamos circuit-breaker compartido y hit-ratio 60 % |  
| Orquestación en frontend | Endpoint único lento | Mejor *perceived performance* (cards aparecen progresivamente) |  
| Sin auth | JWT/api-key fricciona | MVP público; rate-limit por IP suficiente por ahora |  
| Registro manual de adaptadores | Auto-discovery mágico | Tree-shaking y compilación explícita, evita sorpresas |  

---

## 7. ARQUITECTURA FÍSICA (diagrama simplificado)  

```
┌──────────────┐     HTTPS      ┌──────────────┐
│  Usuario     │ ◄────────────► │   Nginx      │  rate-limit 60/IP
│ (móvil)      │                │  (TLS 1.3)   │
└──────┬───────┘                └──────┬───────┘
       │                               │
       ▼                               ▼
Orquestación JS                  API Gateway (Express)
(paralelo)                              │
       │                               ├─ /api/fuentes/sunat
       │                               ├─ /api/fuentes/reniec
       │                               ├─ /api/fuentes/jne
       │                               ├─ /api/generate-names
       │                               └─ /api/health
       │                                ▲ │
       ▼                                │ ▼
Promesas                           Redis (local)
(results streaming)                cache + cb flags
```

---

## 8. ADRs COMPLETOS (sin resumir)  

### ADR-001 – VPS como plataforma primaria  

### ADR-002 – Redis para cache y circuit-breaker  

### ADR-003 – Orquestación en cliente  

### ADR-004 – Adaptador por fuente y registro manual  

### ADR-005 – Sin autenticación, rate-limit por IP  

### ADR-006 – Cacheo de nombres alternativos de IA  

### ADR-007 – Estrategia de health-check y circuit-breaker  
*Ver los detalles de los ADRs en [ADRs-es.md](./ADRs-es.md)*

---

## 9. MÉTRICAS Y OBJETIVOS NUMÉRICOS  
- Latencia: 95º p < 5 s, objetivo 2 s.  
- Disponibilidad externa (UptimeRobot) ≥ 99 %.  
- Hit-ratio cache ≥ 60 %.  
- Hit-ratio cache IA-variants ≥ 30 %.  
- Costo infra ≤ 15 USD/mes (VPS 1 vCPU + 2 GB RAM).  

---

## 10. PRÓXIMOS PASOS / CRONOGRAMA SUGERIDO  
1. Implementar ADR-004 → crear 1er adaptador (el más simple).  
2. Levantar stack Docker (ADR-001) + Redis (ADR-002).  
3. Construir health-check y circuit-breaker (ADR-007).  
4. Desarrollar UI mínima con orquestación paralela (ADR-003).  
5. Añadir rate-limit y validación (ADR-005).  
6. Integrar generador de nombres + cache (ADR-006).  
7. Tests de carga + ajuste de TTL y timeouts.  

---

## 11. CHECKLIST DE SALIDA A PRODUCCIÓN  
✔ Dockerfile + compose funcionando  
✔ CI con `npm audit` y tests unitarios de adaptadores  
✔ SSL automático (certbot)  
✔ Backup diario de Redis  
✔ Alertas UptimeRobot + WebHook Telegram/Slack  
✔ Documentación swagger/redoc de endpoints  

Con esto **queda cerrado el ciclo completo** de definición arquitectónica según Mark Richards: características, ‑ilities, componentes lógicos y **todas** las decisiones documentadas en ADRs.