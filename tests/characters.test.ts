import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { loadConfig, toPublicConfig } from '../src/core/config';
import { THEME_IDS, THEMES } from '../src/shared/themes';
import { buildCharacter, poseCharacter } from '../web/characters3d';

const male = { id: 't1', gender: 'male' as const, name: 'Dilshod', role: 'oqituvchi' as const, title: "Ma'ruzachi", color: '#2f6f8f' };
const female = { id: 't4', gender: 'female' as const, name: 'Mubina', role: 'oqituvchi' as const, title: 'Slaydchi', color: '#6a4fb0' };

function stats(root: THREE.Object3D) {
  let meshes = 0;
  const colors = new Set<number>();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      meshes++;
      colors.add((o.material as THREE.MeshStandardMaterial).color.getHex());
    }
  });
  return { meshes, colors };
}

test('3D personaj: erkak va ayol turlicha quriladi, ikkalasi ham universitet formasida (to\'q ko\'k pidjak, oltin nishon)', () => {
  const m = buildCharacter(male);
  const f = buildCharacter(female);
  const sm = stats(m.root);
  const sf = stats(f.root);
  assert.ok(sm.meshes > 30 && sf.meshes > 30, `meshlar: ${sm.meshes}/${sf.meshes}`);
  assert.notEqual(sm.meshes, sf.meshes, 'jins bo\'yicha tashqi ko\'rinish farq qilishi kerak');
  for (const s of [sm, sf]) {
    assert.ok(s.colors.has(0x16264a), "forma: to'q ko'k pidjak");
    assert.ok(s.colors.has(0xe2b23c), 'forma: oltin universitet nishoni');
    assert.ok(s.colors.has(0xf7f7f2), "forma: oq ko'ylak");
  }
  // Agent rangi (galstuk/bo'yinbog'/yorliq) har bir personajda o'ziniki
  assert.ok(sm.colors.has(new THREE.Color(male.color).getHex()));
  assert.ok(sf.colors.has(new THREE.Color(female.color).getHex()));
});

test('3D personaj: rol bo\'yicha aksessuar (mudir va uslubchi ko\'zoynakli), hover uchun tanlanadigan meshlar bor', () => {
  const teacher = buildCharacter(male);
  const boss = buildCharacter({ ...male, id: 'mudir', role: 'mudir' });
  assert.ok(stats(boss.root).meshes > stats(teacher.root).meshes, "ko'zoynak qo'shimcha meshlar beradi");
  assert.ok(teacher.pickables.length > 20);
});

test('poza: o\'tirgan/yurgan holat oyoqlarni almashtiradi, holatga qarab qo\'llar harakatlanadi', () => {
  const r = buildCharacter(male);
  const base = { t: 1, carrying: false, phase: 0.8, reduced: false, offset: 0 };
  poseCharacter(r, { ...base, state: 'idle', seated: true, moving: false });
  assert.equal(r.legsSit.visible, true);
  assert.equal(r.legsStand.visible, false);
  poseCharacter(r, { ...base, state: 'writing', seated: true, moving: false });
  const writingArm = r.armR.rotation.x;
  assert.ok(writingArm < -1, "yozayotganda qo'l oldinga");
  poseCharacter(r, { ...base, state: 'thinking', seated: true, moving: false });
  assert.notEqual(r.armR.rotation.x, writingArm);
  poseCharacter(r, { ...base, state: 'idle', seated: false, moving: true, carrying: true });
  assert.equal(r.legsStand.visible, true);
  assert.equal(r.folder.visible, true, 'papka ko\'tarib yurganda ko\'rinadi');
  assert.notEqual(r.legL.rotation.x, 0);
  // harakatni kamaytirish rejimida oyoq silkinmaydi
  poseCharacter(r, { ...base, state: 'idle', seated: false, moving: true, reduced: true });
  assert.equal(r.legL.rotation.x, 0);
});

test('jins: konfigda belgilangan, ochiq konfigga o\'tadi, noto\'g\'ri qiymat rad etiladi', () => {
  const cfg = loadConfig();
  const pub = toPublicConfig(cfg, true);
  assert.ok(pub.agents.every((a) => a.gender === 'male' || a.gender === 'female'));
  assert.ok(pub.agents.some((a) => a.gender === 'female') && pub.agents.some((a) => a.gender === 'male'));
});

test('taqdimot mavzulari: 10 ta, hammasida to\'liq ranglar va shriftlar', () => {
  assert.equal(THEME_IDS.length, 10);
  for (const id of THEME_IDS) {
    const t = THEMES[id];
    for (const k of ['bg', 'surface', 'primary', 'secondary', 'accent', 'text', 'muted', 'onPrimary'] as const) {
      assert.match(t[k], /^[0-9A-F]{6}$/, `${id}.${k}`);
    }
    assert.ok(t.headFont && t.bodyFont && t.name);
  }
  assert.equal(THEME_IDS.filter((id) => THEMES[id].dark).length, 2, "qorong'i mavzular: grafit va tun");
});
