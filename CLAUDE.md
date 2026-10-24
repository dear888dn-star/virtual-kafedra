# Virtual Kafedra

AI agentlardan iborat kafedra (Iqtisodiyot va turizm): **Mudir** topshiriqni rejalaydi, **O'qituvchilar** bajaradi, **Uslubchi** tekshiradi, mudir yakuniy hujjatni yig'adi. Hammasi brauzerda pixel-ofis ko'rinishida jonli ko'rinadi. Maqsad: maksimal darajada bepul ishlash (bepul modellar, avtomatik fallback).

## Buyruqlar
- `npm run dev` — server (watch), http://localhost:3100
- `npm start` — serverni oddiy ishga tushirish
- `npm test` — testlar (`node:test` + tsx)
- `npm run typecheck` — server va web uchun tsc
- `npm run eval-lang` — provayderlarning o'zbekcha sifat hisoboti (`reports/lang-eval.md`, kalit kerak)

## Qoidalar
- Model nomlari, endpointlar, limitlar va narxlarni xotiradan yozma: rasmiy hujjatdan tekshir, `docs/ASSUMPTIONS.md` ga manba va sana bilan yoz, tekshirilmaganini konfigda `# VERIFY` deb belgila.
- Sirlar faqat `.env` da (server tomonda). Kodga, logga, brauzerga, git'ga tushirma.
- Foydalanuvchi kalit qo'shmaguncha haqiqiy API chaqirma. Hamma narsa `MOCK=1` rejimida sinaladi.
- Maxfiy topshiriq faqat `trains_on_data: false` provayderlarga; mos provayder bo'lmasa to'xta, bepul modelga yuborma.
- Platformadan mustaqil bo'l (bash'ga tayanadigan skript yozma). Ruxsatsiz hech narsani o'chirma.
- Promptlar kodda emas, `prompts/*.md` da. Model/provayder sozlamalari `config/*.yaml` da.

## Tuzilma
- `config/` kafedra.yaml, providers.yaml, deliverables.yaml · `prompts/` rol promptlari (.md)
- `src/core` orkestrator, hodisalar, konfig · `src/providers` adapterlar, router, limiter, mock · `src/server` Express + SSE
- `src/privacy` PII · `src/export` .docx · `src/shared` server va brauzer umumiy turlari, Markdown parseri · `src/schemas` zod
- `web/` canvas ofis + panellar (esbuild `/app.js` ni so'rov paytida yig'adi) · `runs/` natijalar (gitignore) · `state/` kunlik hisoblagich · `tests/` · `docs/`

Batafsil: `README.md`, `docs/ARCHITECTURE.md`.
