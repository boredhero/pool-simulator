import {expect,test} from './fixtures';
import {acceptWelcomeBeforeLoad} from './welcomeFixture';

for(const mobile of [false,true])test.describe(mobile?'touch shot execution':'desktop shot execution',()=>{
  test.use({viewport:mobile?{width:390,height:844}:{width:1280,height:800},hasTouch:mobile,isMobile:mobile});
  test.beforeEach(async({page})=>{
    await acceptWelcomeBeforeLoad(page);
    await page.addInitScript(()=>{localStorage.setItem('pool:help-dismissed','1');const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=callback=>raf(time=>{const g=(window as any).__pool;if(g)g.scene.renderer.render=()=>{};callback(time);});});
    await page.goto('/');await page.waitForFunction(()=>!!(window as any).__pool);
  });
  test('a side-pocket pot and following scratch both survive playback',async({page})=>{
    const result=await page.evaluate(()=>{
      const g=(window as any).__pool;
      g.coin.cancel();g.cancelOpponent();g.cpuOpponent=false;g.jevGame=null;g.mode='aim';g.options.autoCamera=false;
      Object.assign(g.gs,{current:0,breakShot:false,open:false,groups:['solid','stripe'],winner:null,ballInHand:false});
      g.gs.rules.calls='none';
      for(const b of g.gs.balls)Object.assign(b,{potted:true,asleep:true,z:0,vx:0,vy:0,vz:0,wx:0,wy:0,wz:0});
      Object.assign(g.cue(),{potted:false,x:1.27,y:.65});
      Object.assign(g.gs.balls.find((b:any)=>b.n===1),{potted:false,x:1.27,y:.22});
      g.angle=g.targetAngle=-Math.PI/2;g.tipX=g.tipY=0;
      g.fire(.5,undefined,0);
      let frames=0;while(g.mode==='rolling'&&frames++<300){g.accumulator+=.25;g.frame();}
      return {cuePotted:g.cue().potted,potted:g.gs.balls.find((b:any)=>b.n===1).potted,mode:g.mode,current:g.gs.current,ballInHand:g.gs.ballInHand};
    });
    expect(result.potted).toBe(true);expect(result.cuePotted).toBe(true);expect(result.current).toBe(1);expect(result.ballInHand).toBe(true);expect(result.mode).not.toBe('rolling');
  });
});
