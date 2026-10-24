# Farazlar

Yangilangan: 2026-10-24 (2-bosqich)

## Foydalanuvchi bergan
- Kafedra: Iqtisodiyot va turizm. Tillar: o'zbek (lotin), rus, ingliz.
- Topshiriq namunalari: standart (ma'ruza, test, amaliy mashq, slayd, glossariy).

## Standart sifatida olingan (foydalanuvchi javob bermagan)
- Auditoriya: universitet bakalavr kursi. 5 ta o'qituvchi. Natija: Markdown (`.docx` 5-bosqichda ixtiyoriy).
- Provayder kalitlari hali yo'q: mock rejimi ishlaydi. Maxfiy rejim 4-bosqichda; Ollama ixtiyoriy.
- Server porti 3100 (3000 band bo'lishi mumkin).

## Tekshirilgan (rasmiy hujjat, 2026-10-24)
| Provayder | Nima | Manba |
|---|---|---|
| Gemini | OpenAI-mos base URL `https://generativelanguage.googleapis.com/v1beta/openai/`, `Authorization: Bearer` | ai.google.dev/gemini-api/docs/openai |
| Gemini | Kunlik kvota Tinch okean vaqti yarim tunida nolga tushadi; limit loyiha bo'yicha | ai.google.dev/gemini-api/docs/rate-limits (yangilangan 2026-10-15) |
| Groq | Base URL `https://api.groq.com/openai/v1`; `retry-after` sarlavhasi 429 da; `logprobs`, `n≠1` qo'llanmaydi | console.groq.com/docs/openai, /docs/rate-limits |
| Groq | `openai/gpt-oss-120b`: 30 RPM / 1K RPD / 8K TPM (Developer plan bazasi) | console.groq.com/docs/rate-limits |
| Cerebras | Base URL `https://api.cerebras.ai/v1`; Free Trial `gpt-oss-120b`: 5 RPM, 30K uncached TPM, 1M TPD | inference-docs.cerebras.ai |
| OpenRouter | Base URL `https://openrouter.ai/api/v1`; `:free` modellar 20 RPM, kuniga 50 (10 kreditdan kam) yoki 1000 | openrouter.ai/docs/quickstart, /docs/api-reference/limits |
| Mistral | Endpoint `https://api.mistral.ai/v1/chat/completions`; `response_format: json_object` ishlaydi | docs.mistral.ai/api |
| DeepSeek | Base URL `https://api.deepseek.com`, model `deepseek-flash`; narx USD/1M: Flash peak input miss 0.3, output 1.2 | api-docs.deepseek.com |
| Ollama | `http://localhost:11434/v1/`, kalit e'tiborga olinmaydi, JSON mode bor | docs.ollama.com/api/openai-compatibility |

## Tekshirilmagan (config'da `# VERIFY`)
- Gemini: bepul tarif RPM/RPD qiymatlari sahifada yo'q (AI Studio'da); `rpm: 5, rpd: 100` — ehtiyotkor taxmin. `gemini-3.8-flash` hujjatdagi misol, bepul tarifda borligi tasdiqlanmagan. Bepul tarifda kontent ishlatilishi shartlari o'qilmagan.
- Groq: Free plan limitlari alohida (jadval Developer bazasi); `json_object` qo'llab-quvvatlashi hujjatda tasdiqlanmagan (`json_mode: none`).
- Cerebras: `json_object` o'rniga json_schema tavsiya qilinadi (`json_mode: none`); RPD limiti yo'q.
- OpenRouter va Mistral: model nomlari bo'sh (siz tanlaysiz); Mistral bepul tarif limitlari topilmadi.
- DeepSeek: qat'iy limitlar alohida sahifada; narx peak/off-peak, eng qimmati olingan.
- Hamma provayderda `trains_on_data` (Gemini bepul tarifi `true`, qolganlari `unknown` = maxfiy ishlarga yaroqsiz).
- Hujjatlarni o'qishda veb-sahifa xulosalari ishlatildi; muhim qiymatlarni o'z dashboardingizdan tasdiqlang.

## Texnik qarorlar (2-bosqich)
- Gemini ham OpenAI-mos endpoint orqali umumiy adapterga ulanadi (alohida adapter kerak emas).
- Kunlik hisoblagich `state/usage.json` da, provayderning o'z vaqt zonasida (`reset_tz`) yangilanadi.
- Qayta urinish: 429/5xx/timeout bo'lsa shu provayderda 2 marta (eksponensial 1s, 2s yoki `Retry-After`), so'ng keyingisiga. 60 soniyadan uzun kutish kutilmaydi.
- Hamma provayder tugasa `run_failed` (`reason: limits_exhausted`); `resume` 3-bosqichda.
- Pullik provayder `daily_budget_usd > 0` bo'lmasa yoqilmaydi; byudjet oshsa ish to'xtaydi (`reason: budget`).

## Kompyuter
- Node.js v24.21.0, npm 11.19.0.

## Texnik qarorlar (4-bosqich)
- Maxfiy topshiriq faqat `trains_on_data: false` provayderlarga boradi (`unknown` va `true` maxfiy ishlar uchun yaroqsiz). Mos provayder bo'lmasa ish boshlanmaydi (HTTP 422) va hech narsa yuborilmaydi. Hozircha bunday real provayder faqat mahalliy Ollama (`enabled: true` va model nomi kerak).
- PII aniqlash faqat oddiy regex (telefon, email, pasport AA1234567, Luhn-tekshirilgan karta, 14 raqamli PINFL). Ishonchli emas: noto'g'ri ijobiy va o'tkazib yuborilgan holatlar bo'lishi mumkin. Faqat topshiriq matni tekshiriladi.
- Model chiqishi HTML sifatida emas, DOM daraxti (textContent) orqali ko'rsatiladi; havolalardan faqat http(s) ruxsat etilgan.
- `npm run eval-lang`: yoqilgan va to'liq sozlangan provayderlarga 5 ta o'zbekcha namuna yuboradi, `reports/lang-eval.md` ga yozadi. Baholash avtomatik emas.
