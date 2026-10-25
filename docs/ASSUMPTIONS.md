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

## Gemini bepul kvotasi (haqiqiy 429 xabaridan, 2026-10-24)
- Bepul tarif: **kuniga 20 so'rov, model bo'yicha va loyiha bo'yicha** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, `quotaValue: 20`). Kun Tinch okean vaqti yarim tunida yangilanadi (O'zbekiston vaqti bilan taxminan 12:00).
- `gemini-3.5-flash` aslida `gemini-3.6-flash` kvotasiga yozilgan (alias).
- Har bir model alohida kvotaga ega, shuning uchun `providers.yaml` da bir kalit bilan 4 ta Gemini yozuvi (`gemini`, `gemini-lite`, `gemini-lite2`, `gemini-preview`) zanjirda ketma-ket turadi. Boshqalarining kvotasi 20 deb taxmin qilingan (tasdiqlanmagan).
- Kunlik kvota tugaganini tizim 429 javobidan aniqlaydi, hisobni `state/usage.json` ga yozadi (qayta ishga tushganda ham eslab qoladi) va qayta urinmasdan keyingi modelga o'tadi.

## Taqdimot va tashqi xizmatlar (2026-10-25)
- **Prezi:** rasmiy hujjatlarda "taqdimot yaratish" API'si topilmadi (qidiruvda faqat uchinchi tomon katalogidagi nomuvofiq yozuvlar chiqdi), shuning uchun Prezi'ga to'g'ridan-to'g'ri yozilmaydi. Prezi PPTX/PPT/PDF/DOCX faylni **import** qiladi (support.prezi.com, prezi.com/blog). Natija sifatida `.pptx` yasaladi.
- **NotebookLM:** faqat NotebookLM Enterprise API (Google Cloud, alpha, 2025-09 dan) ochiq; iste'molchi/Gemini API orqali yo'q. Notebooklm-py va shunga o'xshash loyihalar hujjatlanmagan ichki endpointlardan foydalanadi, shuning uchun ishlatilmadi. Manba asosidagi ish `<manba_material>` bilan bajariladi.
- **.pptx kutubxonasi:** `pptxgenjs` 4.0.1 (MIT). Fayl tuzilishi (zip, slaydlar soni, izohlar, jadval) testlar bilan tekshirilgan; PowerPoint/LibreOffice'da vizual ochib tekshirilmagan (kompyuterda o'rnatilmagan). Brauzerdagi ko'rinish bir xil maket mantig'ida chiziladi, lekin piksel-aniq nusxa emas.
- **Rasmlar:** Gemini rasm modellari (kvotasi va bepul tarifdagi ruxsati tekshirilmagan) hozircha ishlatilmaydi.

## Manba qidirish va 3D ofis (2026-10-25)
- **Open Library** (openlibrary.org/search.json): kalitsiz ishlaydi, tekshirildi: inglizcha so'rovlarga ko'p natija beradi, kirill va o'zbekcha so'rovlarga deyarli yo'q. Shuning uchun qidiruv so'rovlari asosan inglizcha tuziladi. Ulanish vaqti-vaqti bilan sekin (15 s gacha).
- **Google Books** API kalitsiz chaqiruvlarda 429 qaytardi (anonim kvota); u ixtiyoriy manba sifatida urinib ko'riladi, xato e'tiborsiz qoldiriladi.
- Qidiruv natijalari faqat katalogda topilgan kitoblar; model "taniqli kitoblar" ro'yxati ham katalogdan tekshiriladi. Kitobning *ichidagi* ma'lumotlarning to'g'riligini tizim tekshira olmaydi (matn berilmasa).
- **PDF:** `unpdf` bilan matn qatlami o'qiladi; OCR yo'q (skaner qilingan PDF rad etiladi).
- **3D:** `three` 0.186 (MIT), brauzer WebGL2 bilan tekshirildi (AMD grafika, ANGLE). Personajlar kod bilan quriladi (tashqi model/rasm yo'q), litsenziya muammosi yo'q. Past quvvatli qurilmalarda sekin bo'lishi mumkin: "Animatsiya" tugmasi harakatni o'chiradi.
- Jinslar konfigda aniq belgilangan (standart qiymatlar ismga qarab qo'yilgan, o'zgartirish mumkin).
