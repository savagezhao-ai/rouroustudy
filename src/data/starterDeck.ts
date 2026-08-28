// 内置入门词库：小学常见 80 词（首次启动自动导入，可随时替换/补充）
import type { Word } from '../lib/db'


function w(word: string, phonetic: string, translation: string): Omit<Word, 'deckId'> {
  return { id: word, word, phonetic, translation }
}

export const starterDeck: Omit<Word, 'deckId'>[] = [
  // 水果食物
  w('apple', '/ˈæpl/', 'n. 苹果'),
  w('banana', '/bəˈnɑːnə/', 'n. 香蕉'),
  w('orange', '/ˈɒrɪndʒ/', 'n. 橙子；橘子'),
  w('egg', '/eɡ/', 'n. 鸡蛋'),
  w('bread', '/bred/', 'n. 面包'),
  w('rice', '/raɪs/', 'n. 大米；米饭'),
  w('meat', '/miːt/', 'n. 肉'),
  w('milk', '/mɪlk/', 'n. 牛奶 v. 挤奶'),
  w('water', '/ˈwɔːtə/', 'n. 水'),
  // 动物
  w('cat', '/kæt/', 'n. 猫'),
  w('dog', '/dɒɡ/', 'n. 狗'),
  w('bird', '/bɜːd/', 'n. 鸟'),
  w('fish', '/fɪʃ/', 'n. 鱼 v. 钓鱼'),
  // 文具教室
  w('book', '/bʊk/', 'n. 书；书本'),
  w('pen', '/pen/', 'n. 钢笔'),
  w('pencil', '/ˈpensl/', 'n. 铅笔'),
  w('ruler', '/ˈruːlə/', 'n. 尺子'),
  w('eraser', '/ɪˈreɪzə/', 'n. 橡皮擦'),
  w('school', '/skuːl/', 'n. 学校'),
  w('classroom', '/ˈklɑːsruːm/', 'n. 教室'),
  w('teacher', '/ˈtiːtʃə/', 'n. 老师'),
  w('student', '/ˈstjuːdnt/', 'n. 学生'),
  // 时间季节
  w('morning', '/ˈmɔːnɪŋ/', 'n. 早上；早晨'),
  w('afternoon', '/ˌɑːftəˈnuːn/', 'n. 下午'),
  w('evening', '/ˈiːvnɪŋ/', 'n. 傍晚；晚上'),
  w('night', '/naɪt/', 'n. 夜晚'),
  w('day', '/deɪ/', 'n. 天；白天'),
  w('week', '/wiːk/', 'n. 星期；周'),
  w('month', '/mʌnθ/', 'n. 月；月份'),
  w('year', '/jɪə/', 'n. 年'),
  w('spring', '/sprɪŋ/', 'n. 春天'),
  w('summer', '/ˈsʌmə/', 'n. 夏天'),
  w('autumn', '/ˈɔːtəm/', 'n. 秋天'),
  w('winter', '/ˈwɪntə/', 'n. 冬天'),
  // 天气温度
  w('sunny', '/ˈsʌni/', 'adj. 晴朗的'),
  w('rainy', '/ˈreɪni/', 'adj. 下雨的'),
  w('windy', '/ˈwɪndi/', 'adj. 有风的'),
  w('hot', '/hɒt/', 'adj. 热的'),
  w('cold', '/kəʊld/', 'adj. 冷的 n. 感冒'),
  w('warm', '/wɔːm/', 'adj. 温暖的'),
  w('cool', '/kuːl/', 'adj. 凉爽的'),
  // 家庭
  w('family', '/ˈfæməli/', 'n. 家庭；家人'),
  w('father', '/ˈfɑːðə/', 'n. 父亲；爸爸'),
  w('mother', '/ˈmʌðə/', 'n. 母亲；妈妈'),
  w('brother', '/ˈbrʌðə/', 'n. 哥哥；弟弟'),
  w('sister', '/ˈsɪstə/', 'n. 姐姐；妹妹'),
  w('grandpa', '/ˈɡrænpɑː/', 'n. 爷爷；外公'),
  w('grandma', '/ˈɡrænmɑː/', 'n. 奶奶；外婆'),
  w('friend', '/frend/', 'n. 朋友'),
  // 身体
  w('hand', '/hænd/', 'n. 手'),
  w('foot', '/fʊt/', 'n. 脚'),
  w('eye', '/aɪ/', 'n. 眼睛'),
  w('ear', '/ɪə/', 'n. 耳朵'),
  w('nose', '/nəʊz/', 'n. 鼻子'),
  w('mouth', '/maʊθ/', 'n. 嘴巴'),
  // 颜色
  w('red', '/red/', 'adj. 红色的'),
  w('blue', '/bluː/', 'adj. 蓝色的'),
  w('green', '/ɡriːn/', 'adj. 绿色的'),
  w('yellow', '/ˈjeləʊ/', 'adj. 黄色的'),
  w('black', '/blæk/', 'adj. 黑色的'),
  w('white', '/waɪt/', 'adj. 白色的'),
  // 动作
  w('run', '/rʌn/', 'v. 跑；奔跑'),
  w('jump', '/dʒʌmp/', 'v. 跳；跳跃'),
  w('swim', '/swɪm/', 'v. 游泳'),
  w('sing', '/sɪŋ/', 'v. 唱歌'),
  w('dance', '/dɑːns/', 'v. 跳舞'),
  w('read', '/riːd/', 'v. 读；阅读'),
  w('write', '/raɪt/', 'v. 写；书写'),
  w('play', '/pleɪ/', 'v. 玩；打（球）'),
  w('eat', '/iːt/', 'v. 吃'),
  w('drink', '/drɪŋk/', 'v. 喝；饮'),
  w('sleep', '/sliːp/', 'v. 睡觉'),
  // 形容词
  w('happy', '/ˈhæpi/', 'adj. 开心的；快乐的'),
  w('sad', '/sæd/', 'adj. 难过的；悲伤的'),
  w('big', '/bɪɡ/', 'adj. 大的'),
  w('small', '/smɔːl/', 'adj. 小的'),
  w('long', '/lɒŋ/', 'adj. 长的'),
  w('short', '/ʃɔːt/', 'adj. 短的；矮的'),
  w('tall', '/tɔːl/', 'adj. 高的'),
  w('new', '/njuː/', 'adj. 新的'),
  w('old', '/əʊld/', 'adj. 旧的；年老的'),
]
