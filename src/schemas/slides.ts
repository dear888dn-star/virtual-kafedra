import { z } from 'zod';
import { LAYOUTS } from '../shared/slides';
import { THEME_IDS } from '../shared/themes';

const str = (max: number) => z.string().trim().min(1).max(max);
const strList = (max: number, itemMax: number) => z.array(str(itemMax)).max(max);

export const SlideSchema = z
  .object({
    layout: z.enum(LAYOUTS).default('bullets'),
    title: str(110),
    subtitle: str(200).optional(),
    bullets: strList(8, 220).optional(),
    left_title: str(60).optional(),
    right_title: str(60).optional(),
    left: strList(6, 200).optional(),
    right: strList(6, 200).optional(),
    stats: z.array(z.object({ value: str(24), label: str(90) })).max(4).optional(),
    quote: str(320).optional(),
    author: str(100).optional(),
    steps: z.array(z.object({ title: str(60), text: str(160).optional() })).max(6).optional(),
    table: z
      .object({ head: z.array(str(50)).min(2).max(5), rows: z.array(z.array(z.string().trim().max(90))).min(1).max(8) })
      .optional(),
    notes: z.string().trim().max(600).optional(),
    visual: z.string().trim().max(240).optional(),
  })
  .superRefine((s, ctx) => {
    const need = (ok: boolean, msg: string) => {
      if (!ok) ctx.addIssue({ code: 'custom', message: `"${s.title}" (${s.layout}): ${msg}` });
    };
    switch (s.layout) {
      case 'bullets':
        need((s.bullets?.length ?? 0) >= 2, 'kamida 2 ta band (bullets) kerak');
        break;
      case 'two_column':
        need((s.left?.length ?? 0) >= 1 && (s.right?.length ?? 0) >= 1, "left va right ro'yxatlari kerak");
        break;
      case 'stats':
        need((s.stats?.length ?? 0) >= 2, 'kamida 2 ta stats (value va label) kerak');
        break;
      case 'quote':
        need(!!s.quote, 'quote matni kerak');
        break;
      case 'timeline':
        need((s.steps?.length ?? 0) >= 3, 'kamida 3 ta steps kerak');
        break;
      case 'table':
        need(!!s.table, 'table kerak');
        if (s.table) need(s.table.rows.every((r) => r.length === s.table!.head.length), "jadval qatorlaridagi ustunlar soni sarlavhaga teng bo'lishi kerak");
        break;
      default:
        break;
    }
  });

export const SlideDeckSchema = z
  .object({
    title: str(140),
    subtitle: str(220).optional(),
    theme: z.enum(THEME_IDS).optional(),
    slides: z.array(SlideSchema).min(3).max(40),
  })
  .superRefine((d, ctx) => {
    if (d.slides[0]?.layout !== 'title') ctx.addIssue({ code: 'custom', message: "birinchi slayd layout: 'title' bo'lishi kerak" });
    if (d.slides[d.slides.length - 1]?.layout !== 'closing') ctx.addIssue({ code: 'custom', message: "oxirgi slayd layout: 'closing' bo'lishi kerak" });
  });
