/**
 * Natijaning ob'ektiv (model fikriga bog'liq bo'lmagan) format tekshiruvi.
 * Uslubchi yumshoq baholasa ham, tuzilma buzilgan ish avtomatik qayta ishlashga qaytariladi.
 */

export interface LintIssue {
  place: string;
  problem: string;
  fix: string;
}

export interface LintOptions {
  /** Ko'rsatmadan olingan so'ralgan miqdor (masalan "10 ta test") */
  expectedCount?: number;
}

const CHATTER = /^\s*(albatta|mana|marhamat|ha,|xo'p|okay|sure|here)\b/i;

/** Ko'rsatma matnidan natija turiga mos miqdorni topadi ("10 ta test", "4 ta masala", "8 slayd"). */
export function expectedCountFor(type: string, instructions: string): number | undefined {
  const re =
    type === 'test'
      ? /(\d{1,3})\s*(?:ta\s*)?(?:test|savol)/i
      : type === 'practice'
        ? /(\d{1,3})\s*(?:ta\s*)?(?:masala|mashq|topshiriq)/i
        : type === 'slides'
          ? /(\d{1,3})\s*(?:ta\s*)?(?:slayd|betlik|sahifalik|varaq)/i
          : null;
  const m = re ? instructions.match(re) : null;
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : undefined;
}

function countMismatch(place: string, label: string, have: number, want?: number): LintIssue[] {
  return want !== undefined && have !== want
    ? [{ place, problem: `${label} soni ${have} ta, so'ralgani ${want} ta`, fix: `Aniq ${want} ta ${label.toLowerCase()} bo'lsin` }]
    : [];
}

export function lintDeliverable(type: string, text: string, opts: LintOptions = {}): LintIssue[] {
  const issues: LintIssue[] = [];
  const t = text.trim();
  if (t.length < 80) {
    return [{ place: 'butun matn', problem: 'Natija juda qisqa yoki bo\'sh', fix: "To'liq natijani yozing" }];
  }
  if (CHATTER.test(t)) {
    issues.push({ place: 'boshlanishi', problem: "Matn kirish gapi bilan boshlangan (\"Albatta\", \"Mana\" va h.k.)", fix: 'Kirish gapini olib tashlang, to\'g\'ridan-to\'g\'ri natijadan boshlang' });
  }

  switch (type) {
    case 'essay':
    case 'report':
    case 'case':
    case 'lesson_plan':
    case 'syllabus':
    case 'exam':
    case 'lecture': {
      const sections = (t.match(/^##\s+\S/gm) ?? []).length;
      if (sections < 3) issues.push({ place: "tuzilma", problem: `${type === 'lecture' ? "Ma'ruzada" : 'Matnda'} ${sections} ta bo'lim (##) bor, kamida 3 ta kerak`, fix: "Kirish, asosiy qism bo'limlari va xulosani ## sarlavhalar bilan ajrating" });
      break;
    }
    case 'test': {
      const heads = [...t.matchAll(/^\s*(?:#{2,4}\s*)?(\d{1,3})[.)]\s+\S/gm)];
      const q = heads.length;
      const answers = (t.match(/to['‘’`]?g['‘’`]?ri\s+javob/gi) ?? []).length;
      const options = (t.match(/^\s*(?:[-*]\s*)?\**[A-D]\**[).:]\s*\S/gm) ?? []).length;
      if (q === 0) {
        issues.push({ place: 'tuzilma', problem: 'Raqamlangan savollar topilmadi', fix: '### 1. Savol matni? ko\'rinishida yozing' });
        break;
      }
      issues.push(...countMismatch('savollar', 'Savollar', q, opts.expectedCount));
      if (answers !== q) issues.push({ place: "to'g'ri javoblar", problem: `${q} ta savol, lekin ${answers} ta "To'g'ri javob"`, fix: "Har bir savol uchun **To'g'ri javob:** va **Izoh:** yozing" });
      if (options < q * 4) issues.push({ place: 'variantlar', problem: `Variantlar yetarli emas (${options} ta, kerak ${q * 4})`, fix: 'Har bir savolda A), B), C), D) variantlari bo\'lsin' });
      break;
    }
    case 'practice': {
      const probs = (t.match(/^\s*#{2,4}\s*\d{1,3}[.)-]/gm) ?? []).length;
      const solutions = (t.match(/yechim/gi) ?? []).length;
      const answers = (t.match(/javob\s*:/gi) ?? []).length;
      if (probs === 0) {
        issues.push({ place: 'tuzilma', problem: 'Raqamlangan masalalar topilmadi', fix: '## 1-masala ko\'rinishida yozing' });
        break;
      }
      issues.push(...countMismatch('masalalar', 'Masalalar', probs, opts.expectedCount));
      if (solutions < probs) issues.push({ place: 'yechimlar', problem: `${probs} ta masala, ${solutions} ta yechim`, fix: 'Har bir masalaga **Yechim:** yozing' });
      if (answers < probs) issues.push({ place: 'javoblar', problem: `${probs} ta masala, ${answers} ta "Javob:"`, fix: 'Har bir masala oxirida **Javob:** yozing' });
      break;
    }
    case 'slides': {
      const slides = (t.match(/^\s*#{2,3}\s*(?:slayd|slide|слайд)\s*\d+/gim) ?? []).length;
      const minSlides = Math.min(3, opts.expectedCount ?? 3);
      if (slides < minSlides) issues.push({ place: 'tuzilma', problem: `${slides} ta slayd topildi, kamida ${minSlides} ta kerak`, fix: '## Slayd 1: Sarlavha ko\'rinishida yozing' });
      else issues.push(...countMismatch('slaydlar', 'Slaydlar', slides, opts.expectedCount));
      break;
    }
    case 'glossary': {
      const rows = t.split('\n').filter((l) => /^\s*\|/.test(l) && !/^\s*\|?\s*:?-{2,}/.test(l));
      const header = rows[0] ?? '';
      const cols = header.split('|').filter((c) => c.trim()).length;
      if (rows.length < 6) issues.push({ place: 'jadval', problem: `Glossariyda ${Math.max(0, rows.length - 1)} ta atama bor, kamida 5 ta kerak`, fix: 'Atamalar jadvalini kengaytiring' });
      if (cols < 3) issues.push({ place: 'jadval', problem: `Jadvalda ${cols} ta ustun bor, o'zbek/rus/ingliz uchun kamida 3 ta kerak`, fix: "O'zbekcha | Русский | English ustunlarini qo'shing" });
      break;
    }
    default:
      break;
  }
  return issues;
}
