> 历史资料：此文档记录旧版本；当前单机 MVP 的功能、启动方式与验收以根目录 README 和 docs/mvp/ 为准。

# Emoji Delta 项目体验与 Bug 审查

更新：2026-10-02 已修复 B01～B12、S01、S02，详见 [修复与验证](C:/Users/PC/project/Emoji-Delta/docs/fixes-2026-10-02/修复与验证.md)。下文保留修复前的审查证据。

审查日期：2026-10-01。审查对象：当前工作区代码。此次只新增审查材料，没有修改 client 或 server 的游戏源代码。

项目已经具备单机原型的基本闭环：登录界面、特工选择、商店、仓库、装备、部署和阵亡返回大厅。当前最需要修复的是结算的一致性、物品使用逻辑、交互状态清理和输入管理。多人联机接入仍有明显缺口，不能仅凭服务端编译通过认定权威服务器架构已经完成。

## 检查方式与验证边界

| 检查项 | 实际完成内容 | 结论边界 |
|---|---|---|
| 桌面 Chrome 体验 | 在 127.0.0.1:8087 使用新建测试档案；检查登录、选择特工、购买、多选装备、部署后的 HUD、阵亡和返回大厅，操作 Tab/H 面板 | 确认主要页面能够打开和切换；没有通过人工跑图完成一次自然撤离 |
| 客户端逻辑 | 对真实 ES 模块运行 19 个隔离案例，检查钥匙、结算、药品、弹药、换弹、被动、搜索、容器、死亡、输入与地图边界 | VM 替换 DOM、音效、UI 输出及动画调度；仅在内存副本中暴露 main.js 状态，不修改生产文件；这些是受控逻辑复现，不是浏览器端到端通关 |
| 服务端构建 | dotnet build server/EmojiDelta.Server.csproj --nologo | 成功，0 警告、0 错误 |
| 服务端逻辑 | 对真实 GameServer.ProcessMessage 运行 4 个隔离案例；为排除随机障碍干扰，在测试实例中清空地形 | 未启动公开监听；没有执行真实多人 WebSocket 并发、断线重连、慢客户端或网络延迟测试 |
| 浏览器日志 | 查看测试页捕获到的 warn/error | 当时没有记录到 warn/error；不能据此证明所有操作无错误 |

未验证真实手机、长时间运行性能、自然战斗通关、局域网第二台设备、数据库持久化和多人同步。浏览器测试使用独立端口的测试存档。

以下 P1 表示影响核心玩法、资产或状态正确性，应优先修复；P2 表示影响配置能力、显示或日常体验。联机上线前的服务端输入校验应视为上线阻断项。

## 已复现的客户端问题

### B01 · P1 · 装备栏里的钥匙卡不能用于开锁

位置：[main.js 的部署逻辑](C:/Users/PC/project/Emoji-Delta/client/js/main.js:92)、[开锁检查](C:/Users/PC/project/Emoji-Delta/client/js/main.js:302)、[LootContainer 的钥匙定义](C:/Users/PC/project/Emoji-Delta/client/js/entities.js:148)。

复现：在测试档案中装备 keycard_red，部署后接近保险柜并交互。结果仍提示“需要红色钥匙卡”，isSearching 为 false。

原因：带入物品保存在 equipped，开锁只检查 player.inventory，而且检查字段是 type；部署过程没有把钥匙转换为可用的局内物品。商店售卖的蓝卡、绿卡也没有对应的容器钥匙类型，当前所有 safe 都固定需要红卡。

建议：统一局内物品结构，部署时把钥匙带入玩家持有物；容器 JSON 明确 requiredKey。验收时同时覆盖“装备带入钥匙”“局内拾取钥匙”“错误颜色钥匙”和“没有钥匙”。

### B02 · P1 · 战利品撤离后重复计价

位置：[撤离结算](C:/Users/PC/project/Emoji-Delta/client/js/main.js:564)、[仓库出售](C:/Users/PC/project/Emoji-Delta/client/js/economy.js:141)。

复现：初始余额 50,000，携带一颗价值 35,000 的蓝钻成功结算。余额变为 90,000（蓝钻价值 + 5,000 奖励），同时仓库仍有这颗蓝钻；出售后又获得 14,000，最终余额 104,000。

原因：同一物品既 addToStash，又 addCoins(totalValue + bonus)。

建议：明确唯一结算方式。若走仓库交易，撤离只入库并发放撤离奖励，金币由出售产生；若直接变现，就不要再保留对应实物。结算应有唯一战局编号和一次性完成标记，避免重复执行。验收应检查钱和物品的守恒关系。

### B03 · P1 · 同一帧可以同时阵亡和撤离成功

位置：[死亡处理](C:/Users/PC/project/Emoji-Delta/client/js/main.js:532)、[随后执行的撤离处理](C:/Users/PC/project/Emoji-Delta/client/js/main.js:539)。

复现：玩家在撤离区，剩余 0.01 秒、HP=1、无护甲；同一帧 Bot 造成致命伤，更新步长 0.02 秒。记录先出现 death，再出现 victory，HP=0，账户仍获得 5,000 奖励。

原因：死亡时设置 isGameOver 并清空装备，但是没有结束当前 update，后续撤离判断继续执行。

建议：死亡进入终态后立即结束当前更新；用统一的结束战局入口处理死亡或成功，保证每局只有一个结局。增加“最后一帧致命伤”和“已经结算后又收到伤害”的验证。

### B04 · P1 · 游戏快捷键会干扰登录输入，失焦后按键不清零

位置：[input.js](C:/Users/PC/project/Emoji-Delta/client/js/input.js:12)、[输入监听初始化](C:/Users/PC/project/Emoji-Delta/client/js/main.js:767)。

复现：向真实输入处理器发送 target 为 INPUT 的 KeyG，事件仍被 preventDefault，并触发“没有手榴弹”游戏通知。KeyW 按下后发送 blur，keys.w 仍为 true，且没有 blur 监听器。

影响：逐键输入用户名/密码时，G、H、1、2、4 等按键可能被拦截；Tab 被用于游戏背包，影响表单切换。按住移动或开火后切换窗口，如果没有收到 keyup/mouseup，状态可能卡住。该结论通过真实输入模块隔离复现；浏览器输入字段被工具脱敏，本次没有把浏览器字段值作为验证证据。

建议：只在 InRaid 且焦点不在 input/textarea/select/contenteditable 时处理游戏键；在 blur 和 document.hidden 时清空 keys、mouse.isDown；按钮点击的 mousedown 不应同时成为开火输入。对一次性操作忽略 e.repeat。

### B05 · P1 · 药品和拾取到的手雷不能按配置使用

位置：[部署时计数](C:/Users/PC/project/Emoji-Delta/client/js/main.js:93)、[useMedkit](C:/Users/PC/project/Emoji-Delta/client/js/main.js:413)、[普通拾取](C:/Users/PC/project/Emoji-Delta/client/js/main.js:324)、[loot.json](C:/Users/PC/project/Emoji-Delta/client/data/loot.json)。

复现：带入外科手术包和肾上腺素，HP=1 后使用药品，只恢复 50 HP；手术包被消耗，肾上腺素仍在装备栏但没有可用入口。另一案例在局内拾取 grenade 后，背包中存在 grenade，usableGrenades 仍为 0，不能投掷。

原因：大小医疗包都汇总到 medkitCount，使用时统一 +50；injector 没有部署处理。手雷可用次数只在部署时统计，拾取不更新。拾取药品还会立即恢复生命并保留实物，使用/保留语义不一致。

建议：每种物品定义明确的使用行为与数值，按物品实例消耗；不要只维护无法反映物品类型的一个计数。决定药品是“拾取即用”还是“放入背包后使用”，并在 F、H、容器拾取三个入口保持一致。

### B06 · P1 · 弹药有三个互相独立的问题

位置：[Player 默认枪定义](C:/Users/PC/project/Emoji-Delta/client/js/entities.js:31)、[部署补给](C:/Users/PC/project/Emoji-Delta/client/js/main.js:113)、[weapons.json](C:/Users/PC/project/Emoji-Delta/client/data/weapons.json)。

| 复现 | 实际结果 | 应有行为 |
|---|---|---|
| 战术特工使用默认枪，带入 9mm 120 发弹药箱 | ammoType 缺失，备弹仍为 120 | 匹配 9mm，备弹应为 240 |
| AK-47 带入标称 90 发步枪弹药箱 | 90 + 120 = 210 | 按配置增加 90，合计 180 |
| 第一把枪 M870、第二把枪 AK-47，带入步枪弹药箱后切到 AK | AK 备弹仍为 90 | 补给应可用于匹配的第二把枪 |

建议：特工默认武器用 weaponId 引用统一武器配置，补齐 ammoType；从物品配置读取 ammoAmount；按弹药类型维护局内备弹，或对所有武器槽正确分配匹配补给。已消耗弹药箱还应有明确的持久化消耗规则。

### B07 · P1 · 切换武器会继承另一把枪的换弹倒计时

位置：[switchWeapon](C:/Users/PC/project/Emoji-Delta/client/js/main.js:430)、[applyWeaponStats](C:/Users/PC/project/Emoji-Delta/client/js/main.js:444)。

复现：AK 空弹开始换弹，等待 1.9 秒，换到 M870。M870 仍继承约 0.1 秒的 reloadTimer；把当前弹匣设为空后继续更新 0.11 秒，M870 已装满 6 发，尽管它配置的换弹时间为 2.5 秒。此案例直接设置弹匣状态，用于隔离验证计时归属。

原因：weaponSlots 只保存 currentAmmo/maxAmmo；isReloading、reloadTimer、cooldown 仍属于共享 player.gun。

建议：把弹匣、换弹、冷却等运行状态放入各武器槽；明确切枪是取消换弹还是后台继续换弹，按选定规则执行。验收覆盖两把枪都非满弹、换弹中切枪、切回原枪。

### B08 · P1 · 特工被动只显示，没有执行

位置：[Player](C:/Users/PC/project/Emoji-Delta/client/js/entities.js:4)、[特工卡片](C:/Users/PC/project/Emoji-Delta/client/js/main.js:799)、[operators.json](C:/Users/PC/project/Emoji-Delta/client/data/operators.json)。

受控验证：战地医生 HP=50，在无敌人场景模拟 10 秒后仍为 50；工程师搜索文件柜仍为 3 秒；狙击手静止散布仍为普通的 0.02。代码检索显示 passive 只用于卡片展示，Player 不保存 passive/passiveValue，更新循环没有消费这些配置。

建议：明确回血延迟与速率、搜索倍率和精准倍率，并把实际被动接入对应系统；卡片改用中文描述显示实际效果。验收应对同条件下的普通特工和相应特工做对照。

### B09 · P1 · 背包搜索可以被 F 或 H 绕过

位置：[interactTarget](C:/Users/PC/project/Emoji-Delta/client/js/main.js:315)、[pickNearbyItem](C:/Users/PC/project/Emoji-Delta/client/js/main.js:729)。

复现一：第一次 F 让遗落背包进入 1.5 秒搜索；搜索未结束时再次 F，会落入普通拾取分支，立即把背包从世界移入 inventory。

复现二：打开 H 面板直接点遗落背包，未搜索即可入包。

影响：跳过搜索约束，背包内生成 2～3 件物品的步骤也被跳过。

建议：三个拾取入口调用同一套规则；searching 状态禁止普通拾取，backpack 必须先完成搜索再领取内容。也应明确“来自容器的背包物品”和“地上需要搜索的死亡背包”是否是不同类型，避免共用 backpack ID 造成行为混淆。

### B10 · P1 · 容器面板可远程拾取，旧战局引用能进入新战局

位置：[pickFromContainer](C:/Users/PC/project/Emoji-Delta/client/js/main.js:255)、[initWorld](C:/Users/PC/project/Emoji-Delta/client/js/main.js:45)、[返回大厅](C:/Users/PC/project/Emoji-Delta/client/js/main.js:844)。

复现一：打开容器面板后，把玩家移到 1,000 像素外，点击拾取仍成功。

复现二：保持 viewingContainer 指向旧容器，然后重新 initWorld；旧容器引用仍存在，可以把旧容器里的 cash 拾入新玩家的背包。

原因：拾取没有验证当前战局、游戏终态、距离和容器是否仍属于当前世界；部署及返回大厅也没有统一关闭面板和清理 viewingContainer/nearbyItems 等状态。

建议：统一 closeRaidPanels/resetRaidState，部署、死亡、成功撤离、返回大厅都调用。拾取入口验证 activeRaidId、仍在战局、目标存在与合法距离；如果不允许隔墙搜取，再验证视线。这是状态与物品完整性问题，不能仅靠隐藏面板处理。

### B11 · P2 · 大厅背包容量不会随装备即时刷新

位置：[特工选择容量计算](C:/Users/PC/project/Emoji-Delta/client/js/main.js:805)、[大厅刷新](C:/Users/PC/project/Emoji-Delta/client/js/ui.js:148)、[equipItem](C:/Users/PC/project/Emoji-Delta/client/js/economy.js:162)。

桌面 Chrome 实测：侦察兵基础 8 格，买入并装备战术背包后，大厅仍显示“容量：8”；第一轮部署后 HUD 显示 12 格。重新点击特工才会重新计算大厅容量。

![背包已装备但大厅容量仍为 8](C:/Users/PC/project/Emoji-Delta/docs/review-2026-10-01/backpack-capacity.png)

建议：把容量计算提取为统一函数，在装备、卸下、切换特工和部署时都调用；切到低容量特工时，应提示超出装备并要求整理。还应限制背包数量：目前大厅只按“存在一个背包”加 4，部署却按每个 backpack 累加 4，两处规则不同。

### B12 · P2 · 自制地图尺寸被固定世界边界截断

位置：[地图编辑器尺寸配置](C:/Users/PC/project/Emoji-Delta/tools/map-editor.html:41)、[固定常量](C:/Users/PC/project/Emoji-Delta/client/js/constants.js:2)、[movePlayer 调用](C:/Users/PC/project/Emoji-Delta/client/js/main.js:504)、[maploader](C:/Users/PC/project/Emoji-Delta/client/js/maploader.js:18)。

复现：构建 100×50、tileSize=64 的地图，worldWidth=6400，玩家出生 x=4512，撤离点 x=5120。移动一帧后玩家 x 被夹到 3176，右半地图的撤离点不可达。

原因：编辑器支持不同尺寸，地图也带尺寸数据；移动和部分随机生成逻辑仍使用 WORLD_WIDTH=3200、WORLD_HEIGHT=2400。

建议：worldWidth/worldHeight/tileSize 属于当前地图实例，移动、随机刷新、相机和渲染统一读取。地图下拉框目前只硬编码一个 option，自制地图也需要明确的导入/登记方式。

## 已复现的服务端问题

### S01 · 联机上线阻断 · 移动、换弹和撤离计时信任客户端 dt

位置：[HandleInput](C:/Users/PC/project/Emoji-Delta/server/GameServer.cs:127)、[ProcessPlayerMovement](C:/Users/PC/project/Emoji-Delta/server/GameWorld.cs:93)。

| 隔离测试 | 实际结果 |
|---|---|
| 一条 INPUT，dt=5，向右移动 | 一次消息移动 1,500 像素，SuspiciousActivity=0 |
| 100 条相同 seq=1、dt=1/60 的 INPUT 连续处理 | 约 1.75 毫秒内移动 500 像素；重复序号未拒绝 |
| 换弹剩余 1.8 秒时发 INPUT、dt=10 | 当前弹匣立即装满 30 发 |
| 身处撤离区发 INPUT、dt=10 | 立即触发撤离完成 |

耗时只反映这次进程内测试，不是网络性能基准。地形在隔离实例中清空，以便独立验证时间处理。

原因：移动、冷却、换弹和撤离都使用 root.dt；防加速上限也乘同一份客户端 dt；消息次数和 seq 不受约束，因此不能证明合法的单位现实时间位移。当前 GameLoop 没有接管这些玩家计时。

建议：网络线程只验证、记录/排队输入；权威 Tick 用服务端固定步长推进玩家移动、冷却、换弹、撤离。校验有限数值、输入速率、序号递增和会话状态。必须用“高频重复包”和“异常 dt”验证修复，不能仅把 dt 改成一个最大值就认为解决了速率问题。

### S02 · P1 · 撤离完成事件会重复，还会广播到其他玩家

位置：[撤离完成](C:/Users/PC/project/Emoji-Delta/server/GameServer.cs:203)、[全会话事件广播](C:/Users/PC/project/Emoji-Delta/server/GameServer.cs:280)。

复现：在撤离区发 dt=10 的 INPUT，再发 dt=0.01 的 INPUT，pending events 为 extraction_start、extraction_complete、extraction_complete；timer=-0.01，IsExtracting 仍为 true。

另外，从广播代码可确定，所有 _pendingEvents 都发送给所有会话；当前事件没有目标玩家标识。这里的“其他玩家收到完成事件”是代码路径确认，本次未执行两个真实 WebSocket 客户端的联机验证。

建议：成功撤离后把会话切换到 Extracted/Lobby，停止当前战局输入和重复结算；事件携带 playerId，并区分给本人发送的结果和给其他玩家发送的离场通知。死亡通知同样应一次性发送，当前 GameLoop 对 HP<=0 的玩家每 Tick 重发。

## 功能与文档的差距

1. **前端没有接通 C# 服务端。** 检索 client 没有 WebSocket、快照处理或预测重放实现；main.js 本地修改 Bot HP、本地执行死亡/撤离，economy.js 本地存储金币。浏览器部署期间没有观察到 WebSocket 创建事件。README 所称“权威服务器 + 客户端预测”目前不能视为已经完成。docs/多人游戏需求文档.md 本身把联机作为从单机升级的待办，应明确当前版本范围。
2. **登录实际是单个本地档案。** economy.js 只有一个 emoji_delta_profile；修改用户名只是改同一档案的名字，并没有不同账号对应的独立资产。simpleHash 是简单无盐 32 位哈希，不能承担服务端密码认证。单机阶段可明确称为“本地档案”；联机阶段再实现用户、认证与数据库。
3. **前后端世界来源不同。** 客户端读取固定 JSON 工厂地图和数据表，服务端 GameWorld.GenerateWorld 仍随机生成障碍、Bot、散落物资。接通网络前需先统一配置与地图，否则实体、出生点、战利品和墙体都不能直接对齐。
4. **交互规则文档不一致。** README 药品按键写 3，实际代码和大厅提示使用 4；Master.md 提到受击会重置撤离，当前客户端只在离开区域时取消撤离。是否保留这些设计需要明确规格后同步文档与实现。

这些差距单列为未完成能力或规格问题，不把需求文档里尚未勾选的整个多人系统算成一个已复现 Bug。

## 体验与实现建议

1. **缩短大厅的主要操作路径。** 当前较宽桌面窗口依旧是居中窄列，大标题和说明占用大量纵向空间，装备、商店和部署需要下滚。可以保留现有视觉风格，用“左侧特工/地图，中间装备仓库，右侧商店”或可切换面板，并把部署按钮固定在可见底部。选中的特工、金币和携带物品应始终容易确认。
2. **给装备明确的槽位与用途。** 主武器、副武器、护甲、背包与消耗品分开；禁止把纯贵重品当作可用装备。购买/装备失败显示原因，例如金币不足、两把枪上限、容量不足。当前 buyItem 返回失败消息，但 UI 没有显示它。
3. **统一物品定义和交互入口。** shop/loot/operator/weapon 的重复字段正在导致数值和行为分叉。用 itemId/weaponId 引用一个定义，局内运行状态另存；F、H、容器和带入物品共同调用校验与应用函数。
4. **先补状态机，再推进联机。** 用 Login → Lobby → Loading → InRaid → Dead/Extracted → Lobby 统一控制输入、面板、实体与资产变化。只有地图加载成功后才切到 InRaid；加载失败留在大厅并给出可操作错误，避免当前 null 地图变成空世界、零尺寸撤离点。
5. **把界面提示与实际状态对应起来。** HUD 把 stamina 原值直接加 %，侦察兵满体力显示 120%、重装兵显示 70%，与进度条归一化不一致；应统一显示百分比或当前/最大体力。距离数值当前是像素却标成 m，应明确换算。按武器显示射击模式，避免 M870/SVD 一律显示“全自动”；区域名读取当前地图。

推荐修复顺序：B02/B03 的结算一致性 → B01/B05/B06 的物品可用性 → B04/B09/B10 的输入和交互状态 → B07/B08 的武器与特工行为 → B11/B12 与显示体验。接通联机前必须同时处理 S01/S02、统一地图协议与资产归属。

## 复现材料

- [客户端审查脚本](C:/Users/PC/project/Emoji-Delta/docs/review-2026-10-01/client-checks.cjs)
- [客户端 19 个案例输出](C:/Users/PC/project/Emoji-Delta/docs/review-2026-10-01/client-results.json)
- [服务端审查工程](C:/Users/PC/project/Emoji-Delta/docs/review-2026-10-01/server-checks.csproj)
- [服务端审查脚本](C:/Users/PC/project/Emoji-Delta/docs/review-2026-10-01/ServerChecks.cs)
- [服务端 4 个案例输出](C:/Users/PC/project/Emoji-Delta/docs/review-2026-10-01/server-results.json)

以上脚本和 JSON 保留修复前的诊断材料；原脚本依赖当时的接口，当前版本请在项目根目录运行新的断言回归：

```powershell
dotnet build server\EmojiDelta.Server.csproj --nologo
node --experimental-vm-modules docs\fixes-2026-10-02\client-regression.cjs
dotnet run --project docs\fixes-2026-10-02\server-regression.csproj
```

原审查脚本记录修复前行为，新的回归脚本包含通过/失败断言。node 的 VM Modules 实验性提示属于测试工具，不是游戏页面错误。本机引用包缓存的构建方式见修复与验证文档。
