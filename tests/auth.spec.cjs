// Testes locais com Supabase simulado: nenhuma conexão com o banco real.
// Instale Playwright em um diretório de testes e rode: node tests/auth.spec.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const fixture = `(() => {
  const user = {id:'test-user',email:'teste@example.com',is_anonymous:false};
  const m = window.mockAuth = {
    user: JSON.parse(localStorage.getItem('test-session') || 'null'),
    queries: [], loginCalls: 0, userCalls: 0, failLogin: false, failUser: false,
    failLogout: false, holdHistory: false, holdItems: false, throwLogin: false,
    items: [{id:1,patrimonio:'10001',nome:'Notebook teste',categoria:'Notebook',status:'Disponível',created_at:'2026-01-01T00:00:00Z'}],
    emit(event, nextUser) {
      this.user = nextUser;
      if (nextUser) localStorage.setItem('test-session', JSON.stringify(nextUser));
      else localStorage.removeItem('test-session');
      this.callback(event, nextUser ? {user:nextUser} : null);
    }
  };
  window.supabase = {createClient(url,key,options) {m.clientOptions=options;return {
    auth: {
      onAuthStateChange(cb) {m.callback=cb; queueMicrotask(()=>cb('INITIAL_SESSION',m.user?{user:m.user}:null));},
      async getUser() {
        m.userCalls++;
        if (m.failUser) return {data:{user:null},error:{name:'AuthApiError',message:'invalid token'}};
        return {data:{user:m.user},error:m.user?null:{name:'AuthSessionMissingError',message:'missing'}};
      },
      async signInWithPassword({email,password}) {
        m.loginCalls++;
        await new Promise(r=>setTimeout(r,50));
        if (m.throwLogin) throw new Error('Failed to fetch');
        if (m.failLogin || password !== 'senha-teste') return {error:{message:'Invalid login credentials'}};
        m.emit('SIGNED_IN',{...user,email}); return {data:{user:m.user},error:null};
      },
      async signInWithOAuth(args) {
        m.oauthCalls=(m.oauthCalls||0)+1;m.oauthArgs=args;
        await new Promise(r=>setTimeout(r,50));
        if(m.failOAuth) throw new Error('OAuth unavailable');
        return {data:{provider:'google',url:'https://accounts.google.com'},error:null};
      },
      async exchangeCodeForSession(code) {
        m.exchangeCalls=(m.exchangeCalls||0)+1;
        if(code!=='test-google-code') return {error:{message:'Invalid code'}};
        m.emit('SIGNED_IN',{...user,email:'google@example.com'});
        return {data:{user:m.user,session:{user:m.user}},error:null};
      },
      async signOut(options) {
        m.logoutOptions=options;
        if(m.failLogout) return {error:{message:'Network error'}};
        m.emit('SIGNED_OUT',null);return {error:null};
      }
    },
    from(table) {
      const q={table,action:'select',select(){return this},order(){return this},limit(){return this},
        insert(value){this.action='insert';this.value=value;return this},
        update(value){this.action='update';this.value=value;return this},
        delete(){this.action='delete';return this},eq(_,id){this.id=id;return this},
        then(resolve,reject){
          m.queries.push({table,action:this.action});
          if(this.action==='insert') m.items.push({id:2,...this.value,created_at:'2026-01-02T00:00:00Z'});
          if(this.action==='update') Object.assign(m.items.find(i=>i.id===this.id),this.value);
          if(this.action==='delete') m.items=m.items.filter(i=>i.id!==this.id);
          const data=table==='estoque'?m.items:[{patrimonio:'10001',acao:'CRIACAO',usuario_email:'teste@example.com'}];
          if(table==='estoque_historico' && m.holdHistory) return new Promise(r=>m.releaseHistory=()=>r({data,error:null})).then(resolve,reject);
          if(table==='estoque' && m.holdItems) return new Promise(r=>m.releaseItems=()=>r({data,error:null})).then(resolve,reject);
          return Promise.resolve({data,error:null}).then(resolve,reject);
        }};return q;
    }
  }}};
})();`;

(async () => {
  const server = http.createServer((req,res) => {
    const file = path.join(root, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
    if(!file.startsWith(root + path.sep)) {res.writeHead(403).end();return;}
    try {res.setHeader('Content-Type', file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}
    catch {res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  const passed=[];
  try {
    browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
    const context=await browser.newContext();
    await context.route('https://**/*', route => route.request().url().includes('supabase-js')
      ?route.fulfill({contentType:'application/javascript',body:fixture}):route.fulfill({body:''}));
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const base='http://127.0.0.1:'+server.address().port;
    const hidden=async selector => assert.equal(await page.locator(selector).isVisible(),false,selector+' deve estar oculto');
    const ready=()=>page.waitForFunction(()=>document.querySelector('#loading-screen').classList.contains('hidden'));
    const signedIn=async()=>{await page.waitForFunction(()=>!document.querySelector('#app-screen').classList.contains('hidden'));await ready();};
    const login=async()=>{await page.fill('#login-email','teste@example.com');await page.fill('#login-password','senha-teste');await page.click('#btn-login');await signedIn();};

    await page.goto(base+'/#estoque');await ready();await hidden('#app-screen');
    if(process.env.SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'login.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>mockAuth.queries.length),0);
    // Disparar handlers ocultos não deve consultar nem alterar dados.
    await page.evaluate(()=>{document.querySelector('#add-form').dispatchEvent(new Event('submit',{cancelable:true}));document.querySelector('#btn-historico').click();document.querySelector('#btn-export').click();});
    assert.equal(await page.evaluate(()=>mockAuth.queries.length),0);
    passed.push('Acesso direto sem sessão e ações internas bloqueados');

    await page.fill('#login-email','teste@example.com');await page.fill('#login-password','incorreta');await page.click('#btn-login');await ready();
    await hidden('#app-screen');assert.match(await page.locator('#toast-container').innerText(),/E-mail ou senha inválidos/);
    passed.push('Credenciais inválidas mantêm o painel bloqueado');

    await page.evaluate(()=>mockAuth.throwLogin=true);
    await page.fill('#login-password','senha-teste');await page.click('#btn-login');await ready();await hidden('#app-screen');
    assert.equal(await page.locator('#btn-login').isEnabled(),true);
    await page.evaluate(()=>mockAuth.throwLogin=false);
    passed.push('Falha de rede libera nova tentativa sem liberar acesso');

    await page.fill('#login-password','senha-teste');
    await page.evaluate(()=>{const f=document.querySelector('#login-form');f.requestSubmit();f.requestSubmit();});
    await signedIn();
    assert.equal(await page.evaluate(()=>mockAuth.loginCalls),3);
    assert.equal(await page.evaluate(()=>mockAuth.queries.length),1);
    assert.match(await page.locator('#table-body').innerText(),/Notebook teste/);
    if(process.env.SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'painel.png'),fullPage:true});
    passed.push('Login válido, envio duplicado bloqueado e carregamento único');
    await page.reload();await signedIn();assert.match(await page.locator('#user-display').innerText(),/teste@example.com/);
    passed.push('Sessão salva validada ao recarregar');

    await page.fill('#patrimonio','10002');await page.fill('#nome','Monitor teste');await page.selectOption('#categoria','Monitor');await page.selectOption('#status','Disponível');
    await page.locator('#add-form button[type=submit]').click();await ready();await page.waitForFunction(()=>document.querySelector('#table-body').textContent.includes('Monitor teste'));
    await page.fill('#search','Monitor teste');assert.match(await page.locator('#table-body').innerText(),/Monitor teste/);assert.doesNotMatch(await page.locator('#table-body').innerText(),/Notebook teste/);
    await page.click('#btn-clear-filters');
    await page.locator('[data-edit-id="2"]').click();await page.fill('#edit-nome','Monitor editado');await page.locator('#edit-form button[type=submit]').click();await ready();
    await page.waitForFunction(()=>document.querySelector('#table-body').textContent.includes('Monitor editado'));
    page.once('dialog',d=>d.accept());await page.locator('[data-delete-id="2"]').click();await ready();await page.waitForFunction(()=>!document.querySelector('#table-body').textContent.includes('Monitor editado'));
    const download=page.waitForEvent('download');await page.click('#btn-export');assert.match((await download).suggestedFilename(),/\.csv$/);
    await page.click('#btn-darkmode');assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('dark')),true);
    passed.push('Cadastro, edição, exclusão, filtros, CSV e tema preservados');

    await page.click('#btn-historico');await page.waitForFunction(()=>!document.querySelector('#history-modal').classList.contains('hidden'));
    await page.evaluate(()=>mockAuth.emit('SIGNED_OUT',null));await hidden('#app-screen');await hidden('#history-modal');
    assert.equal(await page.locator('#history-body').innerHTML(),'');assert.equal(await page.locator('#table-body').innerHTML(),'');
    passed.push('Saída em outra aba fecha modais e limpa dados');

    await login();await page.evaluate(()=>mockAuth.holdHistory=true);await page.click('#btn-historico');await page.waitForFunction(()=>typeof mockAuth.releaseHistory==='function');
    await page.evaluate(()=>{mockAuth.emit('SIGNED_OUT',null);mockAuth.releaseHistory();});await ready();await hidden('#history-modal');await hidden('#app-screen');assert.equal(await page.locator('#history-body').innerHTML(),'');
    passed.push('Histórico atrasado não reaparece após logout');

    await login();await page.evaluate(()=>mockAuth.failUser=true);await page.click('#btn-export');await page.waitForFunction(()=>!document.querySelector('#login-screen').classList.contains('hidden'));await hidden('#app-screen');
    assert.equal(await page.locator('#table-body').innerHTML(),'');await page.evaluate(()=>mockAuth.failUser=false);
    passed.push('Sessão inválida bloqueia exportação e limpa painel');

    await login();await page.evaluate(()=>mockAuth.failLogout=true);await page.click('#btn-logout');await signedIn();assert.match(await page.locator('#toast-container').innerText(),/Não foi possível encerrar/);await page.evaluate(()=>mockAuth.failLogout=false);
    passed.push('Erro de logout informado sem falso sucesso');

    await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('#btn-logout-mobile').isVisible(),true);
    if(process.env.SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'celular.png'),fullPage:true});
    await page.click('#btn-logout-mobile');await ready();await hidden('#app-screen');
    assert.equal(await page.evaluate(()=>mockAuth.logoutOptions.scope),'local');await page.reload();await ready();await hidden('#app-screen');
    passed.push('Logout móvel e persistência da saída');

    await page.evaluate(()=>{mockAuth.holdItems=true;mockAuth.emit('SIGNED_IN',{id:'other',email:'outro@example.com'});});await page.waitForFunction(()=>typeof mockAuth.releaseItems==='function');
    await page.evaluate(()=>{mockAuth.emit('SIGNED_OUT',null);mockAuth.releaseItems();});await ready();await hidden('#app-screen');assert.equal(await page.locator('#table-body').innerHTML(),'');
    passed.push('Estoque atrasado descartado depois da saída');

    const callsBeforeAnonymous=await page.evaluate(()=>mockAuth.userCalls);
    await page.evaluate(()=>{mockAuth.holdItems=false;mockAuth.emit('SIGNED_IN',{id:'anon',is_anonymous:true});});
    await page.waitForFunction(n=>mockAuth.userCalls>n,callsBeforeAnonymous);
    await hidden('#app-screen');await ready();
    passed.push('Conta anônima não recebe acesso');

    const broken=await context.newPage();await broken.route('**/config.js',r=>r.fulfill({contentType:'application/javascript',body:''}));await broken.goto(base);await broken.waitForFunction(()=>document.querySelector('#loading-screen').classList.contains('hidden'));
    assert.equal(await broken.locator('#app-screen').isVisible(),false);assert.match(await broken.locator('#toast-container').innerText(),/Não foi possível iniciar/);
    passed.push('Configuração ausente falha com painel bloqueado');

    await page.goto(base+'/index.html?next=https://invalid.example/#estoque');await ready();
    await page.evaluate(()=>mockAuth.emit('SIGNED_OUT',null));
    assert.equal(await page.locator('#login-email').isVisible(),true);
    assert.equal(await page.locator('#login-password').isVisible(),true);
    await page.evaluate(()=>{document.querySelector('#btn-google').click();document.querySelector('#btn-google').click();});
    await ready();await hidden('#app-screen');
    const oauth=await page.evaluate(()=>({calls:mockAuth.oauthCalls,args:mockAuth.oauthArgs,options:mockAuth.clientOptions,loginCalls:mockAuth.loginCalls}));
    assert.equal(oauth.calls,1);assert.equal(oauth.loginCalls,0);
    assert.equal(oauth.args.provider,'google');assert.equal(oauth.args.options.redirectTo,base+'/index.html');
    assert.equal(oauth.args.options.queryParams.prompt,'select_account');assert.equal(oauth.options.auth.flowType,'pkce');
    passed.push('Botão Google funciona com campos vazios, bloqueia duplicação e usa retorno seguro');

    await page.evaluate(()=>mockAuth.failOAuth=true);await page.click('#btn-google');await ready();await hidden('#app-screen');
    assert.equal(await page.locator('#btn-google').isEnabled(),true);assert.equal(await page.locator('#btn-login').isEnabled(),true);
    assert.match(await page.locator('#toast-container').innerText(),/Não foi possível iniciar o login com Google/);
    passed.push('Falha no Google permite tentar novamente ou usar senha');

    await page.goto(base+'/index.html?code=test-google-code');await signedIn();
    assert.equal(new URL(page.url()).search,'');assert.equal(await page.evaluate(()=>mockAuth.exchangeCalls),1);
    assert.match(await page.locator('#user-display').innerText(),/google@example.com/);
    await page.reload();await signedIn();assert.equal(await page.evaluate(()=>mockAuth.exchangeCalls||0),0);
    await page.click('#btn-logout-mobile');await ready();await hidden('#app-screen');
    passed.push('Retorno Google validado, código removido, sessão restaurada e logout funcionando');

    await page.goto(base+'/index.html?code=invalid-code');await ready();await hidden('#app-screen');
    assert.equal(new URL(page.url()).search,'');assert.match(await page.locator('#toast-container').innerText(),/Não foi possível concluir/);
    passed.push('Código OAuth inválido não libera o painel');

    await page.goto(base+'/index.html#error=access_denied&error_description=cancelled');
    // Simula a navegação completa de volta do provedor, não uma âncora local.
    await page.reload();await ready();await hidden('#app-screen');
    assert.equal(new URL(page.url()).hash,'');assert.match(await page.locator('#toast-container').innerText(),/cancelado ou não foi autorizado/);
    await login();
    passed.push('Cancelamento Google tratado e login por senha preservado');

    assert.deepEqual(errors,[]);
    console.log(passed.map((x,i)=>'OK '+(i+1)+' — '+x).join('\n'));
    console.log(passed.length+' cenários aprovados; nenhum erro JavaScript. Supabase simulado.');
  } finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
