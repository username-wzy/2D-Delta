// shopdata.js - Shop item loader
import { getCoins, spendCoins, addToStash } from './economy.js';

let shopItems = [];

export async function loadShopData(path = 'data/shop.json') {
  try {
    const resp = await fetch(path);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    shopItems = await resp.json();
  } catch (e) {
    console.warn('shop.json load failed:', e.message);
    shopItems = getFallback();
  }
  console.log(`🏪 Loaded ${shopItems.length} shop items`);
  return shopItems;
}

function getFallback() {
  return [
    { id: 'weapon_ak47', emoji: '🔫', name: 'AK-47', price: 12000, category: 'weapon' },
    { id: 'armor_heavy', emoji: '🛡️', name: '重型护甲', price: 15000, category: 'armor' },
    { id: 'medkit', emoji: '💊', name: '医疗包', price: 2000, category: 'consumable' },
    { id: 'ammo_9mm', emoji: '📦', name: '9mm弹药', price: 1500, category: 'ammo' },
  ];
}

/** Get all shop items */
export function getShopItems() { return shopItems; }

/** Try to buy an item. Returns { success, message } */
export function buyItem(shopIndex) {
  if (shopIndex < 0 || shopIndex >= shopItems.length) {
    return { success: false, message: '商品不存在' };
  }
  const item = shopItems[shopIndex];
  if (!spendCoins(item.price)) {
    return { success: false, message: `金币不足! 需要 $${item.price.toLocaleString()}` };
  }
  addToStash({
    id: item.id,
    emoji: item.emoji,
    name: item.name,
    value: item.price
  });
  return { success: true, message: `购买成功: ${item.name}` };
}
