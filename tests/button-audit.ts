import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { DesktopShell } from '../apps/desktop/shell';
import { defaults, heightPresets } from '../packages/protocol';
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export async function auditButtons(shell:DesktopShell,evidence:string){
  const rows:{control:string;expected:string;actual:unknown;status:string;method:string}[]=[];
  const js=(code:string)=>shell.overlay.webContents.executeJavaScript(code),pj=(code:string)=>shell.popupWindow!.webContents.executeJavaScript(code);
  const settle=()=>pause(140);
  const signs=()=>js(`Array.from(document.querySelectorAll('[data-shop]')).map(el=>{const r=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el.querySelector('span'));return{shop:el.dataset.shop,hidden:el.hidden,width:r.width,height:r.height,bottom:r.bottom,roadY:Number(document.body.dataset.worldY),glyphHeight:range.getBoundingClientRect().height,font:getComputedStyle(el).fontSize,highlighted:el.classList.contains('is-hovered')}})`);
  const snapshot=async()=>({state:shell.state(),overlayVisible:shell.overlay.isVisible(),focusable:shell.overlay.isFocusable(),popupVisible:shell.popupWindow?.isVisible(),popupFocusable:shell.popupWindow?.isFocusable(),scale:await js('document.body.dataset.worldScale'),signs:await signs()});
  const row=async(control:string,expected:string,fn:()=>void|Promise<void>)=>{await fn();rows.push({control,expected,actual:await snapshot(),status:'pass',method:'native Electron windows + programmatic DOM activation; not physical clicks'});};
  const click=async(id:string,popup=false)=>{await(popup?pj:js)(`document.getElementById('${id}').click()`);await settle();};
  const waitPopup=async(kind:string)=>{for(let n=0;n<150;n++){if(shell.popup?.kind===kind&&shell.popupWindow?.isVisible()&&await pj(`document.body.dataset.popupReady==='true' && document.body.dataset.popup==='${kind}'`))return;await pause(30);}throw Error('popup not ready '+kind);};
  const stable=async(fn:()=>Promise<void>)=>{const b=shell.overlay.getBounds(),scale=await js('document.body.dataset.worldScale');await fn();assert.deepEqual(shell.overlay.getBounds(),b);assert.equal(await js('document.body.dataset.worldScale'),scale);};
  const point=async(x:number,y:number)=>{await js(`document.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:${x},clientY:${y}}))`);await settle();};
  const actor=async()=>{const b=await js('JSON.parse(document.body.dataset.playerBounds)');await point(b.x+b.width/2,b.y+b.height/2);await waitPopup('actor');};
  shell.restore();shell.store.save({...defaults});shell.settingsChanged();await settle();
  await row('主工具栏','只有设置、隐藏；店外没有返回，没有旧开始/发送/更多/左右按钮',async()=>{assert.deepEqual(await js("Array.from(document.querySelectorAll('#primaryBar button:not([hidden])')).map(e=>e.id)"),['openSettings','displayHide']);assert.equal(await js("['enter','composerToggle','moreToggle','panLeft','panRight','returnCamp'].some(id=>document.getElementById(id))"),false);});
  for(let n=0;n<6;n++){
    await stable(async()=>{await click('openSettings');await waitPopup('settings');});const id=shell.popupWindow!.id;
    await stable(async()=>{await click('openSettings');assert.equal(shell.popup,null);assert.equal(shell.popupWindow!.isVisible(),false);});assert.equal(shell.popupWindow!.id,id);
  }
  await row('设置 / 再次点击与重复切换','6次开关复用同一个附着子面板；主窗112、缩放不变',()=>{assert.equal(shell.overlay.getBounds().height,112);});
  await click('openSettings');await waitPopup('settings');
  await row('设置 / 贴合锚点','原生父窗口就是营地；无框透明，面板不抢键盘，尾角朝按钮',()=>{assert.equal(shell.popupWindow!.getParentWindow(),shell.overlay);assert.equal(shell.popupWindow!.isFocusable(),false);assert.equal(shell.popup!.side,'bottom');assert.ok(shell.popup!.tail>0);});
  await click('alwaysOnTop',true);
  await row('设置 / 取消置顶立即生效','不点保存：主街和面板立即取消置顶，设置持久化为false',()=>{assert.equal(shell.overlay.isAlwaysOnTop(),false);assert.equal(shell.popupWindow!.isAlwaysOnTop(),false);assert.equal(shell.store.value.alwaysOnTop,false);});
  await click('alwaysOnTop',true);
  await row('设置 / 开启置顶立即生效','不点保存：主街和面板立即置顶，设置持久化为true',()=>{assert.equal(shell.overlay.isAlwaysOnTop(),true);assert.equal(shell.popupWindow!.isAlwaysOnTop(),true);assert.equal(shell.store.value.alwaysOnTop,true);});
  await stable(async()=>{await pj("document.getElementById('cameraX').value='127';document.getElementById('cameraX').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('cameraX').dispatchEvent(new Event('change',{bubbles:true}));");await settle();});
  await row('设置 / 镜头滑块','127逻辑像素位置立即预览并持久化；主窗高度/比例不变',()=>{assert.equal(shell.cameraX,127);assert.equal(shell.store.value.cameraX,127);assert.equal(shell.overlay.getBounds().height,112);});
  let normalizedGlyphHeight:number|undefined;
  for(const h of heightPresets){await pj(`document.querySelector('[data-height="${h}"]').click()`);await settle();await row('设置 / '+h+' DIP档位','明确档位改变主窗高度、单个选中、尾角随按钮；店牌、文字等比缩放，48档隐藏店铺',async()=>{assert.equal(shell.overlay.getBounds().height,h);const actual=await js("(()=>{const r=document.getElementById('openSettings').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()");assert.deepEqual(shell.popup!.anchor,actual);assert.equal(await pj("document.querySelectorAll('#heightChoices [aria-pressed=true]').length"),1);assert.equal(await pj("document.getElementById('height')===null"),true);const scale=Number(await js('document.body.dataset.worldScale'));for(const sign of await signs()){assert.equal(sign.hidden,h===48);if(sign.hidden)continue;assert.ok(Math.abs(sign.width-66*scale)<.1);assert.ok(Math.abs(sign.height-57*scale)<.1);assert.ok(Math.abs(sign.bottom-sign.roadY-2*scale)<.1);normalizedGlyphHeight??=sign.glyphHeight/scale;assert.ok(Math.abs(sign.glyphHeight/scale-normalizedGlyphHeight)<.1);}});}
  await row('高度档位 / 原生resize先到','先收到新窗口尺寸、后收到设置状态，48档切出仍正确恢复倍率、文字和店铺；切回48不残留店铺',async()=>{
    await pj("document.querySelector('[data-height=\"48\"]').click()");await settle();
    // Reproduce the actual ordering reported by independent acceptance: AppKit
    // delivers resize while the renderer still holds its old 48px settings.
    const bounds=shell.overlay.getBounds();shell.overlay.setBounds({...bounds,height:112});await settle();
    assert.equal(await js('innerHeight'),112);assert.equal(Number(await js('document.body.dataset.worldScale')),.5);
    await pj("document.querySelector('[data-height=\"112\"]').click()");await settle();
    assert.equal(Number(await js('document.body.dataset.worldScale')),1);assert.equal((await signs()).some((s:any)=>s.hidden),false);
    shell.overlay.setBounds({...shell.overlay.getBounds(),height:48});await settle();
    await pj("document.querySelector('[data-height=\"48\"]').click()");await settle();
    assert.equal((await signs()).every((s:any)=>s.hidden),true);assert.equal(Number(await js('document.body.dataset.worldScale')),.5);
  });
  await click('reset',true);await row('设置 / 安全默认','回到112、底部、镜头0、安静且不清理其他数据',()=>assert.deepEqual(shell.store.value,defaults));
  await pj("document.getElementById('dock').value='top';document.getElementById('mode').value='friends';document.getElementById('opacity').value='.8';document.getElementById('volume').value='.3';document.getElementById('soundEnabled').checked=true;document.getElementById('bubbles').checked=false;document.getElementById('alwaysOnTop').checked=false;document.getElementById('save').click()");await settle();
  await row('设置 / 保存及选择开关','显式保存顶部、非置顶、好友模式、音量/气泡；不改变112高度',()=>{assert.equal(shell.overlay.getBounds().y,shell.selectedDisplay().workArea.y);assert.equal(shell.overlay.getBounds().height,112);assert.equal(shell.overlay.isAlwaysOnTop(),false);assert.equal(shell.store.value.mode,'friends');assert.equal(shell.store.value.opacity,.8);assert.equal(shell.store.value.volume,.3);assert.equal(shell.store.value.bubbles,false);});
  await click('export',true);const backup=await pj("document.getElementById('backupText').value");
  await row('设置 / 导出','只含schema/version/settings，没有身份或余额',()=>{assert.deepEqual(Object.keys(JSON.parse(backup)).sort(),['schema','settings','version']);assert.equal(JSON.parse(backup).settings.version,4);});
  await click('reset',true);await pj(`document.getElementById('backupText').value=${JSON.stringify(backup)};document.getElementById('import').click()`);await settle();
  await row('设置 / 导入','恢复合法设置，保持同一子面板和主窗112',()=>{assert.equal(shell.store.value.dock,'top');assert.equal(shell.store.value.bubbles,false);assert.equal(shell.popup!.kind,'settings');});
  const bad=JSON.parse(backup);bad.settings.token='invalid-fixture';await pj(`document.getElementById('backupText').value=${JSON.stringify(JSON.stringify(bad))};document.getElementById('import').click()`);await settle();
  await row('设置 / 拒绝非法导入','错误显示在面板，现有设置不变',async()=>{assert.ok(await pj("document.getElementById('popupError').textContent.length"));assert.equal(shell.store.value.dock,'top');});
  await click('reset',true);await stable(()=>click('popupClose',true));
  await row('设置 / 关闭','仅收起子面板，主画布和键盘权限不变',()=>{assert.equal(shell.popup,null);assert.equal(shell.overlay.isFocusable(),false);});
  await stable(actor);await row('点击人物','先显示动作菜单，尚无输入框、无键盘焦点',async()=>{assert.equal(await pj("document.getElementById('draft')===null"),true);assert.equal(shell.keyboard,false);assert.equal(shell.popupWindow!.isFocusable(),false);});
  await stable(()=>click('popupClose',true));await row('人物菜单 / 关闭','只收起动作菜单，主街不变',()=>assert.equal(shell.popup,null));
  await actor();await stable(async()=>{await click('talk',true);await waitPopup('dialogue');});
  await row('人物菜单 / 对话','显式对话才让子面板可聚焦，主街始终不可聚焦',()=>{assert.equal(shell.keyboard,true);assert.equal(shell.popupWindow!.isFocusable(),true);assert.equal(shell.overlay.isFocusable(),false);});
  await stable(async()=>{await pj("document.getElementById('draft').value='<img src=x onerror=alert(1)>';document.getElementById('sendLocal').click()");await settle();});
  await row('对话 / 发送','本地气泡文本转义，112 DIP和场景倍率均不改变',async()=>{assert.equal(await js("document.getElementById('bubble').querySelector('img')===null && document.getElementById('bubble').textContent.includes('<img')"),true);assert.equal(await pj("document.getElementById('draft').value"),'');});
  const message=shell.localMessage!.id;await pj("document.getElementById('draft').value=' ';document.getElementById('sendLocal').click()");await settle();
  await row('对话 / 空输入','显示错误，不发送',()=>assert.equal(shell.localMessage!.id,message));
  await stable(async()=>{await pj("document.getElementById('draft').value='第一条';document.getElementById('sendLocal').click();document.getElementById('draft').value='继续编辑的新草稿';document.getElementById('sendLocal').click()");await settle();});
  await row('对话 / 快速重复发送与新草稿','回包保留新编辑草稿，同一在途消息只发送一次',async()=>{assert.equal(shell.localMessage!.id,message+1);assert.equal(await pj("document.getElementById('draft').value"),'继续编辑的新草稿');});
  await stable(()=>click('popupClose',true));await row('对话 / 关闭','收起输入、释放焦点、不缩放街道',()=>{assert.equal(shell.keyboard,false);assert.equal(shell.popupWindow!.isFocusable(),false);});
  await actor();await click('talk',true);await waitPopup('dialogue');
  await js("document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:Number(document.body.dataset.worldX)+400,clientY:109}))");await settle();
  assert.equal(await js("document.getElementById('hoverMarker').hidden"),false);
  await stable(async()=>{await pj("document.getElementById('draft').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");await settle();});
  await row('对话 / Escape清除道路预选','键盘关闭对话后释放焦点并清除虚影，无需等待鼠标离开',async()=>{assert.equal(shell.popup,null);assert.equal(shell.keyboard,false);assert.equal(await js("document.getElementById('hoverMarker').hidden"),true);});
  const b=await js('JSON.parse(document.body.dataset.playerBounds)');await point(b.x+b.width+30,b.y+b.height-6);
  await row('点击史莱姆','本地抚摸跳动反馈，不弹输入、不改变高度',async()=>{assert.ok(Number(await js('document.body.dataset.petCount'))>=1);assert.equal(shell.overlay.getBounds().height,112);});
  const x=await js('Number(document.body.dataset.worldX)+350'),y=109,start=Number(await js('document.body.dataset.playerX'));
  await js("document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:"+x+",clientY:"+y+"}))");await settle();
  await row('道路悬停 / 虚影箭头','悬停先显示淡色预选箭头及手形，尚未移动',async()=>{assert.equal(await js("document.getElementById('hoverMarker').hidden"),false);assert.equal(await js('document.documentElement.style.cursor'),'pointer');assert.equal(Number(await js('document.body.dataset.playerX')),start);});
  await point(x,y);
  await row('点击道路 / 目标箭头','显示发光旋转箭头并移动，手形命中，不改变高度',async()=>{assert.equal(await js("document.getElementById('moveMarker').hidden"),false);assert.ok(Number(await js('document.body.dataset.playerX'))>start);});
  await pause(1700);await row('道路 / 抵达目标','抵达后目标箭头自动消失',async()=>assert.equal(await js("document.getElementById('moveMarker').hidden"),true));
  const visualHighlights:unknown[]=[];
  for(const [shop,px]of [['shop-bakery',90],['shop-alchemy',290]] as const){
    const ox=Number(await js('document.body.dataset.worldX')),oy=Number(await js('document.body.dataset.worldY'));
    const region={x:Math.round(ox+px-32),y:Math.round(oy-70),width:64,height:48};
    const capture=async(label:string)=>{const image=await shell.overlay.webContents.capturePage(region);fs.writeFileSync(path.join(evidence,`${shop}-${label}.png`),image.toPNG());const bitmap=image.toBitmap();let sum=0;for(let i=0;i<bitmap.length;i+=4)sum+=bitmap[i]+bitmap[i+1]+bitmap[i+2];return sum/(bitmap.length/4*3);};
    const highlighted=async(frame:string)=>{assert.equal(await js('document.body.dataset.hover'),frame);assert.deepEqual((await signs()).filter((s:any)=>s.highlighted).map((s:any)=>s.shop),[shop]);assert.equal(await js('document.documentElement.style.cursor'),'pointer');};
    await js("document.dispatchEvent(new MouseEvent('mouseleave'))");await settle();const before=await capture('idle');
    await js(`(()=>{const el=document.querySelector('[data-shop="${shop}"] span'),r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}))})()`);await settle();
    const after=await capture('sign-hover');visualHighlights.push({shop,region,before,after,ratio:after/before,method:'native Electron capturePage: real rendered store pixels; synthetic DOM mousemove, not physical OS hover'});
    await row('立牌文字 / '+shop,'悬停文字同时提亮所属店面与店牌；另一家不亮，鼠标手形',async()=>{await highlighted(shop);assert.ok(after>before*1.08,`Store did not visibly brighten: ${before} -> ${after}`);});
    await js(`document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:${ox+px},clientY:${oy-45}}))`);await settle();
    await row('店面悬停 / '+shop,'悬停店面同样提亮所属立牌，店面与文字使用同一组状态',()=>highlighted(shop));
    await js("document.dispatchEvent(new MouseEvent('mouseleave'))");await settle();
    await row('离开店面 / '+shop,'离开后两家店牌高亮均清除，不残留选中发光',async()=>assert.equal((await signs()).some((s:any)=>s.highlighted),false));
  }
  fs.writeFileSync(path.join(evidence,'sign-hover-pixels.json'),JSON.stringify(visualHighlights,null,2));
  for(const [name,px,shop]of [['补给商店',90,'shop-bakery'],['炼金工坊',290,'shop-alchemy']] as const){const ox=Number(await js('document.body.dataset.worldX')),oy=Number(await js('document.body.dataset.worldY'));await stable(()=>point(ox+px,oy-45));await row('点击'+name,'仅该房子切换到对应室内剖面，街道高度/倍率/镜头不变，旁边立牌变为离开',async()=>{assert.equal(shell.view,'interior');assert.equal(shell.activeShop,shop);assert.equal(await js('document.body.dataset.interiorFrame'),px===90?'interior-bakery':'interior-alchemy');assert.equal(shell.overlay.getBounds().height,112);assert.equal(await js("document.querySelector('[data-shop=\""+shop+"\"]').textContent.includes('离开')"),true);assert.equal(await js("document.getElementById('returnCamp')===null"),true);});await js(`(()=>{const el=document.querySelector('[data-shop="${shop}"]'),r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));})()`);await settle();assert.equal(await js('document.body.dataset.hover'),px===90?'interior-bakery':'interior-alchemy');await stable(async()=>{await js("document.querySelector('[data-shop=\""+shop+"\"]').click()");await settle();});await row('店旁立牌 / 离开'+name,'点中文离开立牌复原外墙；静止指针仍同时高亮店面与店牌，高度/焦点不变',async()=>{assert.equal(shell.view,'street');assert.equal(shell.overlay.getBounds().height,112);assert.equal(shell.overlay.isFocusable(),false);assert.equal(await js('document.body.dataset.hover'),shop);assert.equal((await signs()).find((s:any)=>s.shop===shop).highlighted,true);});}
  await click('openSettings');await waitPopup('settings');await pj("document.getElementById('interactionEnabled').checked=false;document.getElementById('save').click()");await settle();const a=await js('JSON.parse(document.body.dataset.playerBounds)');await point(a.x+a.width/2,a.y+a.height/2);
  await row('设置 / 禁用交互','角色/道路/店铺不能进入交互，设置和隐藏仍可用',()=>assert.equal(shell.popup!.kind,'settings'));
  await click('reset',true);await click('hide',true);await row('设置 / 隐藏','街道和子面板隐藏，恢复箭头可见且不抢焦点',()=>{assert.equal(shell.overlay.isVisible(),false);assert.equal(shell.popupWindow!.isVisible(),false);assert.equal(shell.recovery.isVisible(),true);assert.equal(shell.recovery.isFocusable(),false);});
  await shell.recovery.webContents.executeJavaScript("document.getElementById('recoverArrow').click()");await settle();await row('恢复箭头','只回展示态112；不获取键盘',()=>{assert.equal(shell.mode,'display');assert.equal(shell.overlay.getBounds().height,112);assert.equal(shell.overlay.isFocusable(),false);});
  await click('displayHide');await row('主工具 / 隐藏','立即隐藏、清除气泡、停止绘制、留下恢复箭头',()=>{assert.equal(shell.mode,'hidden');assert.equal(shell.recovery.isVisible(),true);assert.equal(shell.localMessage,null);});shell.restore();await settle();
  return rows;
}
