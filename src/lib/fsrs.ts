// FSRS 调度封装：与 Anki 26.x 内置的是同一套算法
import { fsrs, generatorParameters, createEmptyCard, Rating } from 'ts-fsrs'

export const scheduler = fsrs(
  generatorParameters({
    enable_fuzz: true, // 加一点随机抖动，避免大量卡片同一天到期
  }),
)

export { Rating, createEmptyCard }
