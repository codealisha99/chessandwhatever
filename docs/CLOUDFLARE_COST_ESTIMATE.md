# Cloudflare Cost Analysis & Infrastructure Comparison

**Project:** Gambit (`chessandwhatever`)  
**Scope:** Production Cost Model & Comparison (Railway vs. Cloudflare Architecture)  
**Date:** 2026-11-21  

---

## 1. Executive Summary

Migrating Gambit from Railway to Cloudflare introduces dramatic structural cost efficiencies:
1. **$0 Egress Fees:** Cloudflare does not charge for egress bandwidth across its global network, eliminating unexpected networking bills.
2. **Workers Paid Plan ($5/mo):** Bundles 10,000,000 requests, Hyperdrive connection pooling, Anycast routing, DDoS mitigation, and WAF rules.
3. **Decoupled Scale:** Frontend (Vercel free tier), Edge Gateway (Cloudflare $5/mo), Managed Database (Neon free tier / $19/mo), and Managed Redis (Upstash $0–$10/mo).

---

## 2. Itemized Cloudflare Component Costs

### 2.1 Cloudflare Edge & Compute
| Component | Billing Metric | Cost | Details & Quotas |
| :--- | :--- | :--- | :--- |
| **Cloudflare Workers Paid** | Base Monthly | **$5.00 / month** | Includes 10,000,000 requests/month; $0.50 per additional 1M requests. |
| **Cloudflare Hyperdrive** | Add-on | **$0.00 (Included)** | Included with Workers Paid plan. Connection pooling for Neon PostgreSQL. |
| **Cloudflare Containers / VM** | Compute / Memory | **$5.00 – $15.00 / mo** | 1 vCPU, 1 GB RAM continuous container for WebSocket & engine. |
| **Cloudflare Egress Bandwidth** | Bandwidth Transfer | **$0.00 (Free)** | Zero egress bandwidth charges worldwide. |
| **Cloudflare SSL & DDoS** | Security | **$0.00 (Free)** | Automated Universal SSL and unmetered Layer 3/4/7 DDoS mitigation. |

### 2.2 External Managed Services
| Component | Provider | Cost Profile | Quota / Tier |
| :--- | :--- | :--- | :--- |
| **PostgreSQL Database** | Neon Serverless | **$0.00 / month** (Free tier) or **$19.00 / month** (Launch tier) | Free tier includes 0.5 GB storage and 100 hours compute. Launch tier includes 10 GB storage and unlimited compute. |
| **Redis 7 Cluster** | Upstash Redis | **$0.00 – $10.00 / month** | Free tier: 10,000 commands/day.<br/>Pay-as-you-go: $0.20 per 100k commands.<br/>Fixed plan: $10/month for 500k commands/day. |
| **Frontend Hosting** | Vercel | **$0.00 / month** (Hobby) or **$20.00 / month** (Pro) | Global edge hosting with automated CI/CD. |

---

## 3. Traffic Scenario Projections

### Scenario A: Early Stage / Development (< 1,000 Monthly Active Users)
- **Edge Requests:** ~500,000 requests/month (within 10M base)
- **Concurrent WebSockets:** 5–30 concurrent players
- **Cloudflare Workers:** $5.00
- **Cloudflare Container:** $5.00
- **Neon PostgreSQL:** $0.00 (Free Tier)
- **Upstash Redis:** $0.00 (Free Tier)
- **Vercel Frontend:** $0.00 (Free Tier)
- **Total Projected Cost:** **$10.00 / month**

### Scenario B: Steady Growth (10,000 Monthly Active Users)
- **Edge Requests:** ~4,000,000 requests/month (within 10M base)
- **Concurrent WebSockets:** 100–300 concurrent players
- **Cloudflare Workers:** $5.00
- **Cloudflare Container:** $10.00
- **Neon PostgreSQL:** $19.00 (Launch Plan with autoscaling)
- **Upstash Redis:** $6.00 (Pay-as-you-go ~3M commands)
- **Vercel Frontend:** $0.00 (Free Tier)
- **Total Projected Cost:** **$40.00 / month**

### Scenario C: High Volume Scale (50,000 Monthly Active Users)
- **Edge Requests:** ~25,000,000 requests/month (10M included + 15M overage @ $0.50/M = $7.50)
- **Concurrent WebSockets:** 1,000+ concurrent players (multi-container cluster)
- **Cloudflare Workers:** $12.50
- **Cloudflare Containers (Cluster):** $25.00
- **Neon PostgreSQL:** $19.00 – $35.00
- **Upstash Redis:** $15.00 – $25.00
- **Vercel Frontend:** $20.00 (Pro)
- **Total Projected Cost:** **$91.50 – $117.50 / month**

---

## 4. Architectural Cost Comparison: Railway vs. Cloudflare

| Cost Item | Railway Deployment | Cloudflare Architecture | Savings / Advantage |
| :--- | :--- | :--- | :--- |
| **Compute Engine** | $5 base fee + $0.000231/GB-hour + CPU ($15–$30/mo) | $5 Workers + Container ($10–$15/mo) | Predictable, lower idle cost |
| **Outbound Bandwidth** | $0.10 per GB over 100 GB | **$0.00 (Unlimited)** | **100% savings on egress** |
| **DDoS & Edge Routing** | Basic proxy | Enterprise-grade Anycast Edge & WAF | Significantly higher security posture |
| **Database Acceleration** | Direct TCP only | Hyperdrive edge pooling included | Lower latency, zero extra charge |
| **Cold Starts** | Idle sleep or persistent billing | 0ms CORS at edge, instant response | Better user experience |
