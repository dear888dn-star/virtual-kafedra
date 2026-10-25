import type { KafedraEvent } from '../src/shared/events';

export interface BoardInfo {
  task: string;
  done: number;
  total: number;
}

/** 2D (zaxira) va 3D ofis uchun umumiy interfeys. */
export interface OfficeLike {
  setBoard(b: BoardInfo): void;
  setReduced(v: boolean): void;
  setDark(v: boolean): void;
  handle(e: KafedraEvent): void;
  resize(): void;
  resetAll(): void;
}
