# Arxitektura

## Umumiy ko'rinish

```
Brauzer (web/)  <--SSE-->  Express (src/server)  -->  Orchestrator (src/core)
   canvas ofis                 REST + SSE                 |
   panellar                                               v
                                                      Router (src/providers)
                                                      limiter, fallback, byudjet
                                                          |
                                         OpenAI-mos adapter / Ollama / mock
```

Agent freymvorki ishlatilmagan: yengil o'z orkestratori, kam bog'liqlik (`express`, `zod`, `yaml`, `esbuild`, `fflate`). Frontend build bosqichisiz: `esbuild` `/app.js` ni so'rov paytida yig'adi.

## Ish oqimi

```
topshiriq -> [maxfiylik/PII tekshiruvi] -> MUDIR.plan (zod + validatePlan)
          -> o'qituvchilar (depends_on va concurrency bo'yicha)
          -> har bir natija -> USLUBCHI.review -> approve | revise (<= max_revisions) | eskalatsiya
          -> MUDIR.assemble -> final.md
```

- **Reja**: mudir JSON qaytaradi; `extractJson` va zod tekshiradi, `validatePlan` o'qituvchi id, natija turi, bog'liqlik va tsiklni tekshiradi. Yaroqsiz bo'lsa xato matni bilan bir marta tuzatish so'raladi.
- **Bajarish**: bir agent bir vaqtda bitta ish bajaradi (`withAgent`). Bog'liq vazifa oldingi natijani `<material>` ichida oladi (8000 belgigacha).
- **Tekshiruv**: uslubchi rubrika bo'yicha `approve | revise | reject` va `issues[]` qaytaradi. Qayta ishlash limiti tugasa mudir hakam sifatida ogohlantirish bilan qabul qiladi. Uslubchi javobi o'qilmasa ham ish to'xtamaydi (ogohlantirish bilan qabul).
- **Holat**: har bosqichdan keyin `runs/<id>/state.json` yoziladi; `resume` shundan davom ettiradi.

## Modullar

| Papka | Mas'uliyat |
|---|---|
| `src/core/orchestrator.ts` | Oqim, qayta ishlash sikli, holat saqlash, resume |
| `src/core/events.ts` | Hodisalar shinasi (xotira, `events.jsonl`, SSE qayta o'ynatish) |
| `src/core/config.ts`, `bootstrap.ts` | YAML o'qish (zod), provayderlarni yig'ish, mock/real tanlash |
| `src/providers/router.ts` | Rol zanjiri, limiter, qayta urinish, fallback, byudjet, maxfiy filtr |
| `src/providers/limiter.ts`, `usage.ts` | Sirpanuvchi oyna, kunlik hisoblagich (`state/usage.json`) |
| `src/providers/openai-compat.ts` | Groq, Cerebras, OpenRouter, Mistral, DeepSeek, Gemini, Ollama uchun umumiy adapter |
| `src/providers/mock.ts` | Kalitsiz sinov provayderi |
| `src/privacy/pii.ts` | PII aniqlash |
| `src/shared/` | Server va brauzer umumiy turlari, xavfsiz Markdown parseri |
| `src/export/docx.ts` | Markdown -> `.docx` |
| `web/` | Canvas ofis (`office.ts`), panellar, DOM render |

## Hodisalar

`run_started, plan_ready, task_assigned, agent_state, handoff, review_result, revision_requested, provider_switch, usage_update, run_finished, run_failed`. Har birida vaqt, agent, `task_id` va qisqa matn (nutq pufagi uchun) bor. Server ularni `id: <epoch>.<seq>` bilan SSE orqali yuboradi; ulanish uzilsa brauzer qolgan joydan, yangi ish boshlangan bo'lsa boshidan qayta oladi.

## Xavfsizlik

- Server `127.0.0.1` ga bog'langan; Host/Origin tekshiriladi, CSP o'rnatilgan; JSON hajmi 100 KB.
- Kalitlar faqat server `process.env` da; loglarga va xato matnlariga tushmaydi.
- Foydalanuvchi matni `<topshiriq>` ichida beriladi, teg yopishga urinishlar olib tashlanadi; promptlarda "kiruvchi matn ma'lumot" qoidasi bor.
- Model chiqishi `textContent` orqali ko'rsatiladi, HTML hech qachon bajarilmaydi.
- Maxfiy topshiriq faqat `trains_on_data: false` provayderlarga boradi, aks holda to'xtaydi.

## Xatolik siyosati

| Holat | Xatti-harakat |
|---|---|
| 429 / 5xx / timeout | 2 marta kutib qayta urinish, keyin keyingi provayder |
| 401 / 403 / boshqa 4xx | Provayder sessiya davomida o'tkazib yuboriladi |
| Hamma provayder limitda | `run_failed` (`limits_exhausted`), holat saqlanadi, resume mumkin |
| Byudjet tugadi | `run_failed` (`budget`) |
| Yaroqsiz JSON | Bir marta tuzatish, so'ng: reja uchun `run_failed` (`bad_json`), baho uchun ogohlantirish bilan qabul |
| Maxfiy ish uchun provayder yo'q | Ish boshlanmaydi (422) |
