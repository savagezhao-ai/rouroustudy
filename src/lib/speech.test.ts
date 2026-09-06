import { describe, it, expect } from 'vitest'
import { expandAbbr } from './speech'

describe('expandAbbr 缩写展开', () => {
  it('英文：展开常用缩写', () => {
    expect(expandAbbr('give sth to sb', 'en')).toBe('give something to somebody')
    expect(expandAbbr('used esp by omitting letters', 'en')).toBe('used especially by omitting letters')
    expect(expandAbbr('way of moving, eg of an athlete', 'en')).toBe('way of moving, for example of an athlete')
    expect(expandAbbr('alphabet, ie all the letters', 'en')).toBe('alphabet, that is all the letters')
    expect(expandAbbr('abbr. Q', 'en')).toBe('abbreviation. Q')
    expect(expandAbbr('[usu passive]', 'en')).toBe('[usually passive]')
  })

  it('英文：绝不误伤正常单词（词边界 + 剔除易撞词）', () => {
    expect(expandAbbr('sing a song', 'en')).toBe('sing a song') // sing 是动词
    expect(expandAbbr('an ant walked', 'en')).toBe('an ant walked') // ant 是蚂蚁
    expect(expandAbbr('eat a fig', 'en')).toBe('eat a fig') // fig 是无花果
    expect(expandAbbr('lit a fire', 'en')).toBe('lit a fire') // lit 是 light 过去式
    expect(expandAbbr('a fried egg', 'en')).toBe('a fried egg') // eg 在 egg 内不展开
    expect(expandAbbr('usual pattern', 'en')).toBe('usual pattern') // usu 在 usual 内不展开
    expect(expandAbbr('friend of mine', 'en')).toBe('friend of mine') // ie 在 friend 内不展开
    expect(expandAbbr('a piece of cake', 'en')).toBe('a piece of cake') // ie 在 piece 内不展开
  })

  it('中文：展开成中文词，由中文语音朗读', () => {
    expect(expandAbbr('给 sb 和 sth', 'zh')).toBe('给 某人 和 某物')
    expect(expandAbbr('esp 用于否定', 'zh')).toBe('尤其 用于否定')
    expect(expandAbbr('abbr 缩写', 'zh')).toBe('缩写 缩写')
  })

  it('空字符串安全', () => {
    expect(expandAbbr('', 'en')).toBe('')
  })
})
