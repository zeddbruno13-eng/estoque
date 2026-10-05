(() => {
  window.ESTOQUE_AUTH_BUILD = "auth-final-20260928-2";
  console.info("Estoque TI Auth build:", window.ESTOQUE_AUTH_BUILD);
  "use strict";

  /* =========================================================
     1. CONFIGURAÇÃO DO SUPABASE
     ========================================================= */

  let supabase;
  let authRevision = 0;
  let sessionVersion = 0;
  let authBusy = false;

  const PAGE_SIZE = 10;

  const CATEGORIAS = [
    "Notebook",
    "Desktop",
    "Monitor",
    "Servidor",
    "Switch",
    "Roteador",
    "Impressora",
    "Nobreak",
    "Periférico",
    "Outro"
  ];

  const STATUS = ["Disponível", "Em Uso", "Manutenção", "Descarte"];

  const state = {
    user: null,
    items: [],
    filteredItems: [],
    page: 1,
    search: "",
    category: "",
    status: "",
    sortField: "created_at",
    sortDirection: "desc"
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const ui = {
    loginScreen: $("#login-screen"),
    appScreen: $("#app-screen"),
    loading: $("#loading-screen"),
    loginForm: $("#login-form"),
    loginEmail: $("#login-email"),
    loginPassword: $("#login-password"),
    userDisplay: $("#user-display"),
    addForm: $("#add-form"),
    editForm: $("#edit-form"),
    tableBody: $("#table-body"),
    historyBody: $("#history-body"),
    emptyState: $("#empty-state"),
    historyEmpty: $("#history-empty"),
    search: $("#search"),
    categoryFilter: $("#filter-categoria"),
    statusFilter: $("#filter-status"),
    pageInfo: $("#page-info"),
    resultSummary: $("#results-summary"),
    btnPrev: $("#btn-prev"),
    btnNext: $("#btn-next"),
    total: $("#total-count"),
    available: $("#disponivel-count"),
    inUse: $("#em-uso-count"),
    maintenance: $("#manutencao-count")
  };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    populateSelects();
    registerEvents();
    restoreTheme();
    setAuthBusy(true);
    setLoading(true);
    try {
      const config = window.ESTOQUE_CONFIG;
      if (!window.supabase?.createClient || !config?.supabaseUrl || !config?.supabaseKey) {
        throw new Error("Configuração ou biblioteca indisponível");
      }
      supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true, flowType: "pkce", detectSessionInUrl: false }
      });
      // O callback é síncrono: chamadas ao Auth aqui podem bloquear o SDK.
      supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT" || !session?.user) {
          showLogin();
        } else if (!authBusy && event !== "INITIAL_SESSION") {
          const version = sessionVersion;
          window.setTimeout(() => {
            if (version === sessionVersion && !authBusy) void verifySession();
          }, 0);
        }
      });
      window.addEventListener("pageshow", (event) => {
        if (event.persisted) {
          setAuthBusy(false);
          showLogin();
          void verifySession();
        }
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && state.user && !authBusy) {
          void verifySession();
        }
      });
      // O código de retorno é trocado uma única vez, usando o verificador PKCE
      // salvo pelo SDK neste mesmo navegador. Nenhum token vem de um formulário.
      if (!await handleOAuthReturn()) return;
      await verifySession();
    } catch (error) {
      showLogin();
      toast("Não foi possível iniciar o acesso. Verifique a conexão e a configuração do sistema.", "error");
    } finally {
      setAuthBusy(false);
      setLoading(false);
    }
  }

  /* =========================================================
     2. EVENTOS
     ========================================================= */

  function registerEvents() {
    ui.loginForm.addEventListener("submit", login);
    $("#btn-google").addEventListener("click", loginWithGoogle);
    ui.addForm.addEventListener("submit", createItem);
    ui.editForm.addEventListener("submit", updateItem);

    $$("[data-logout]").forEach((button) => button.addEventListener("click", logout));
    $("#btn-darkmode").addEventListener("click", toggleTheme);
    $("#btn-historico").addEventListener("click", openHistory);
    $("#btn-export").addEventListener("click", exportCsv);
    $("#btn-clear-filters").addEventListener("click", clearFilters);
    $("#btn-toggle-password").addEventListener("click", togglePassword);

    ui.search.addEventListener("input", (event) => {
      state.search = event.target.value.trim().toLowerCase();
      state.page = 1;
      applyFilters();
    });

    ui.categoryFilter.addEventListener("change", (event) => {
      state.category = event.target.value;
      state.page = 1;
      applyFilters();
    });

    ui.statusFilter.addEventListener("change", (event) => {
      state.status = event.target.value;
      state.page = 1;
      applyFilters();
    });

    ui.btnPrev.addEventListener("click", () => {
      if (state.page > 1) {
        state.page -= 1;
        renderTable();
      }
    });

    ui.btnNext.addEventListener("click", () => {
      const totalPages = getTotalPages();
      if (state.page < totalPages) {
        state.page += 1;
        renderTable();
      }
    });

    $$(".sort-button").forEach((button) => {
      button.addEventListener("click", () => changeSort(button.dataset.field));
    });

    document.addEventListener("click", (event) => {
      const closeTarget = event.target.closest("[data-close]");
      if (closeTarget) closeModal(closeTarget.dataset.close);

      const editButton = event.target.closest("[data-edit-id]");
      if (editButton) openEdit(Number(editButton.dataset.editId));

      const deleteButton = event.target.closest("[data-delete-id]");
      if (deleteButton) deleteItem(Number(deleteButton.dataset.deleteId));
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeModal("edit-modal");
        closeModal("history-modal");
      }
    });
  }

  /* =========================================================
     3. AUTENTICAÇÃO
     ========================================================= */

  function setAuthBusy(busy) {
    authBusy = busy;
    $("#btn-login").disabled = busy;
    $("#btn-google").disabled = busy;
  }

  async function loginWithGoogle() {
    if (authBusy) return;
    if (!supabase) {
      toast("O serviço de acesso não carregou. Verifique a conexão e recarregue a página.", "error");
      return;
    }
    if (!["http:", "https:"].includes(window.location.protocol)) {
      toast("Abra o sistema pelo Live Server ou pelo endereço do site para entrar com Google.", "warning");
      return;
    }
    setAuthBusy(true);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          // Mantém o caminho da instalação, sem reutilizar parâmetros externos.
          redirectTo: window.location.origin + window.location.pathname,
          queryParams: { prompt: "select_account" }
        }
      });
      if (error) throw error;
      // O SDK redireciona ao Google. O painel só abre ao validar o retorno.
    } catch (error) {
      toast("Não foi possível iniciar o login com Google. Tente novamente ou use e-mail e senha.", "error");
    } finally {
      setAuthBusy(false);
      setLoading(false);
    }
  }

  async function handleOAuthReturn() {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.slice(1));
    const code = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error") || hash.get("error") ||
      url.searchParams.get("error_code") || hash.get("error_code");
    const oauthDescription = url.searchParams.get("error_description") ||
      hash.get("error_description");

    if (!code && !oauthError) return true;

    // Guarda a mensagem antes de limpar a URL para mostrar o erro verdadeiro.
    const detalheOAuth = (oauthDescription || oauthError || "Erro de autenticação")
      .replace(/\+/g, " ")
      .trim();

    for (const key of ["code", "error", "error_code", "error_description"]) {
      url.searchParams.delete(key);
    }
    if (hash.has("error") || hash.has("error_code") || hash.has("error_description")) {
      url.hash = "";
    }
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);

    if (oauthError) {
      console.error("OAuth Google retornou erro:", {
        error: oauthError,
        description: oauthDescription
      });
      showLogin();
      toast(`ERRO GOOGLE: ${detalheOAuth}`, "error");
      return false;
    }
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      return true;
    } catch (error) {
      console.error("Falha ao trocar o código OAuth pela sessão:", error);
      showLogin();
      const detalhe = error?.message || "Falha desconhecida ao criar a sessão";
      toast(`ERRO GOOGLE: ${detalhe}`, "error");
      return false;
    }
  }

  async function login(event) {
    event.preventDefault();
    if (authBusy) return;
    if (!supabase) {
      toast("O serviço de acesso não carregou. Verifique a conexão e recarregue a página.", "error");
      return;
    }
    const email = ui.loginEmail.value.trim();
    const password = ui.loginPassword.value;
    if (!email || !password || !ui.loginForm.reportValidity()) {
      toast("Preencha e-mail e senha.", "warning");
      return;
    }
    setAuthBusy(true);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (await verifySession()) {
        ui.loginForm.reset();
        resetPasswordVisibility();
        toast("Login realizado com sucesso.", "success");
      }
    } catch (error) {
      showLogin();
      toast(translateAuthError(error.message), "error");
    } finally {
      setAuthBusy(false);
      setLoading(false);
    }
  }

  async function logout() {
    if (authBusy || !supabase) return;
    setAuthBusy(true);
    // Fecha inclusive os modais e invalida respostas que ainda estejam em trânsito.
    showLogin();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      toast("Sessão encerrada neste navegador.", "success");
    } catch (error) {
      toast("Não foi possível encerrar a sessão no serviço. Verifique sua conexão e tente sair novamente.", "error");
      await verifySession();
    } finally {
      setAuthBusy(false);
      setLoading(false);
    }
  }

  async function verifiedUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!data?.user || data.user.is_anonymous) return null;
    return data.user;
  }

  async function verifySession() {
    const revision = ++authRevision;
    try {
      const user = await verifiedUser();
      if (revision !== authRevision) return false;
      if (!user) { showLogin(); return false; }
      await enterApp(user);
      return Boolean(state.user);
    } catch (error) {
      if (revision !== authRevision) return false;
      showLogin();
      if (error.name !== "AuthSessionMissingError") {
        toast("Não foi possível validar sua sessão. Entre novamente ou verifique a conexão.", "warning");
      }
      return false;
    }
  }

  async function requireUser() {
    if (!state.user || authBusy) return false;
    const version = sessionVersion;
    const id = state.user.id;
    try {
      const user = await verifiedUser();
      if (version !== sessionVersion) return false;
      if (user?.id === id) return true;
    } catch (error) {
      if (version !== sessionVersion) return false;
    }
    showLogin();
    toast("Sua sessão não está disponível. Entre novamente.", "warning");
    return false;
  }

  async function enterApp(user) {
    if (state.user?.id === user.id) return;
    showLogin();
    state.user = user;
    sessionVersion += 1;
    ui.userDisplay.textContent = user.email || "Usuário autenticado";
    ui.loginScreen.classList.add("hidden");
    ui.appScreen.classList.remove("hidden");
    ui.appScreen.inert = false;
    await loadItems();
  }

  function showLogin() {
    authRevision += 1;
    sessionVersion += 1;
    state.user = null;
    state.items = [];
    state.filteredItems = [];
    ui.appScreen.classList.add("hidden");
    ui.appScreen.inert = true;
    ui.loginScreen.classList.remove("hidden");
    closeModal("edit-modal");
    closeModal("history-modal");
    ui.historyBody.innerHTML = "";
    ui.userDisplay.textContent = "";
    ui.addForm.reset();
    ui.editForm.reset();
    ui.loginPassword.value = "";
    resetPasswordVisibility();
    clearFilters();
    updateCards();
    setLoading(false);
  }

  function resetPasswordVisibility() {
    ui.loginPassword.type = "password";
    $("#btn-toggle-password i").className = "fa-solid fa-eye";
  }

  function togglePassword() {
    const isPassword = ui.loginPassword.type === "password";
    ui.loginPassword.type = isPassword ? "text" : "password";
    $("#btn-toggle-password i").className = isPassword
      ? "fa-solid fa-eye-slash"
      : "fa-solid fa-eye";
  }

  /* =========================================================
     4. SELECTS
     ========================================================= */

  function populateSelects() {
    const categoryOptions = CATEGORIAS.map(
      (item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`
    ).join("");

    const statusOptions = STATUS.map(
      (item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`
    ).join("");

    $("#categoria").innerHTML = `<option value="">Selecione...</option>${categoryOptions}`;
    $("#edit-categoria").innerHTML = `<option value="">Selecione...</option>${categoryOptions}`;
    ui.categoryFilter.innerHTML = `<option value="">Todas as categorias</option>${categoryOptions}`;

    $("#status").innerHTML = `<option value="">Selecione...</option>${statusOptions}`;
    $("#edit-status").innerHTML = `<option value="">Selecione...</option>${statusOptions}`;
    ui.statusFilter.innerHTML = `<option value="">Todos os status</option>${statusOptions}`;
  }

  /* =========================================================
     5. CRUD
     ========================================================= */

  async function loadItems() {
    if (!state.user) return;
    const version = sessionVersion;
    setLoading(true);

    const { data, error } = await supabase
      .from("estoque")
      .select("*")
      .order("created_at", { ascending: false });

    setLoading(false);
    if (version !== sessionVersion || !state.user) return;

    if (error) {
      console.error(error);
      toast("Erro ao carregar o estoque. Verifique as tabelas e políticas do Supabase.", "error");
      return;
    }

    state.items = data || [];
    applyFilters();
    updateCards();
  }

  async function createItem(event) {
    event.preventDefault();
    if (!await requireUser()) return;
    const version = sessionVersion;

    const item = {
      patrimonio: $("#patrimonio").value.trim(),
      nome: $("#nome").value.trim(),
      categoria: $("#categoria").value,
      status: $("#status").value,
      responsavel: emptyToNull($("#responsavel").value),
      descricao: emptyToNull($("#descricao").value)
    };

    const validationMessage = validateItem(item);
    if (validationMessage) {
      toast(validationMessage, "warning");
      return;
    }

    setLoading(true);

    const { error } = await supabase.from("estoque").insert(item);

    setLoading(false);
    if (version !== sessionVersion || !state.user) return;

    if (error) {
      console.error(error);
      toast(databaseErrorMessage(error), "error");
      return;
    }

    ui.addForm.reset();
    toast("Equipamento cadastrado com sucesso.", "success");
    await loadItems();
  }

  function openEdit(id) {
    if (!state.user) return;
    const item = state.items.find((row) => row.id === id);
    if (!item) return;

    $("#edit-id").value = item.id;
    $("#edit-patrimonio").value = item.patrimonio ?? "";
    $("#edit-nome").value = item.nome ?? "";
    $("#edit-categoria").value = item.categoria ?? "";
    $("#edit-status").value = item.status ?? "";
    $("#edit-responsavel").value = item.responsavel ?? "";
    $("#edit-descricao").value = item.descricao ?? "";

    openModal("edit-modal");
  }

  async function updateItem(event) {
    event.preventDefault();
    if (!await requireUser()) return;
    const version = sessionVersion;

    const id = Number($("#edit-id").value);
    const item = {
      patrimonio: $("#edit-patrimonio").value.trim(),
      nome: $("#edit-nome").value.trim(),
      categoria: $("#edit-categoria").value,
      status: $("#edit-status").value,
      responsavel: emptyToNull($("#edit-responsavel").value),
      descricao: emptyToNull($("#edit-descricao").value),
      updated_at: new Date().toISOString()
    };

    const validationMessage = validateItem(item);
    if (validationMessage) {
      toast(validationMessage, "warning");
      return;
    }

    setLoading(true);

    const { error } = await supabase
      .from("estoque")
      .update(item)
      .eq("id", id);

    setLoading(false);
    if (version !== sessionVersion || !state.user) return;

    if (error) {
      console.error(error);
      toast(databaseErrorMessage(error), "error");
      return;
    }

    closeModal("edit-modal");
    toast("Equipamento atualizado com sucesso.", "success");
    await loadItems();
  }

  async function deleteItem(id) {
    if (!await requireUser()) return;
    const version = sessionVersion;
    const item = state.items.find((row) => row.id === id);
    if (!item) return;

    const confirmed = window.confirm(
      `Deseja excluir o equipamento ${item.nome} (patrimônio ${item.patrimonio})?`
    );

    if (!confirmed) return;

    setLoading(true);

    const { error } = await supabase.from("estoque").delete().eq("id", id);

    setLoading(false);
    if (version !== sessionVersion || !state.user) return;

    if (error) {
      console.error(error);
      toast("Não foi possível excluir o equipamento.", "error");
      return;
    }

    toast("Equipamento excluído.", "success");
    await loadItems();
  }

  /* =========================================================
     6. FILTROS, ORDENAÇÃO E PAGINAÇÃO
     ========================================================= */

  function applyFilters() {
    let result = [...state.items];

    if (state.search) {
      result = result.filter((item) => {
        const haystack = [
          item.patrimonio,
          item.nome,
          item.responsavel,
          item.descricao
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(state.search);
      });
    }

    if (state.category) {
      result = result.filter((item) => item.categoria === state.category);
    }

    if (state.status) {
      result = result.filter((item) => item.status === state.status);
    }

    result.sort((a, b) => compareValues(a[state.sortField], b[state.sortField]));

    if (state.sortDirection === "desc") {
      result.reverse();
    }

    state.filteredItems = result;

    const totalPages = getTotalPages();
    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;

    renderTable();
  }

  function changeSort(field) {
    if (state.sortField === field) {
      state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
    } else {
      state.sortField = field;
      state.sortDirection = "asc";
    }

    state.page = 1;
    updateSortIcons();
    applyFilters();
  }

  function updateSortIcons() {
    $$(".sort-button").forEach((button) => {
      const icon = button.querySelector("i");

      if (button.dataset.field !== state.sortField) {
        icon.className = "fa-solid fa-sort";
        return;
      }

      icon.className = state.sortDirection === "asc"
        ? "fa-solid fa-sort-up"
        : "fa-solid fa-sort-down";
    });
  }

  function renderTable() {
    const total = state.filteredItems.length;
    const totalPages = getTotalPages();
    const start = (state.page - 1) * PAGE_SIZE;
    const pageItems = state.filteredItems.slice(start, start + PAGE_SIZE);

    ui.tableBody.innerHTML = pageItems.map((item) => `
      <tr>
        <td><strong>${escapeHtml(item.patrimonio)}</strong></td>
        <td>
          <strong>${escapeHtml(item.nome)}</strong>
          ${item.descricao ? `<span class="description-text" title="${escapeHtml(item.descricao)}">${escapeHtml(item.descricao)}</span>` : ""}
        </td>
        <td>${escapeHtml(item.categoria)}</td>
        <td><span class="status-badge ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
        <td>${escapeHtml(item.responsavel || "—")}</td>
        <td>${formatDate(item.created_at)}</td>
        <td class="cell-actions">
          <button class="action-btn action-edit" type="button" title="Editar" data-edit-id="${item.id}">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="action-btn action-delete" type="button" title="Excluir" data-delete-id="${item.id}">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join("");

    ui.emptyState.classList.toggle("hidden", total !== 0);
    ui.tableBody.closest(".table-responsive").classList.toggle("hidden", total === 0);

    ui.resultSummary.textContent = `${total} ${total === 1 ? "item encontrado" : "itens encontrados"}`;
    ui.pageInfo.textContent = `Página ${state.page} de ${totalPages}`;
    ui.btnPrev.disabled = state.page <= 1;
    ui.btnNext.disabled = state.page >= totalPages;
  }

  function getTotalPages() {
    return Math.max(1, Math.ceil(state.filteredItems.length / PAGE_SIZE));
  }

  function clearFilters() {
    state.search = "";
    state.category = "";
    state.status = "";
    state.page = 1;

    ui.search.value = "";
    ui.categoryFilter.value = "";
    ui.statusFilter.value = "";

    applyFilters();
  }

  function updateCards() {
    ui.total.textContent = state.items.length;
    ui.available.textContent = state.items.filter((item) => item.status === "Disponível").length;
    ui.inUse.textContent = state.items.filter((item) => item.status === "Em Uso").length;
    ui.maintenance.textContent = state.items.filter((item) => item.status === "Manutenção").length;
  }

  /* =========================================================
     7. HISTÓRICO
     ========================================================= */

  async function openHistory() {
    if (!await requireUser()) return;
    const version = sessionVersion;
    setLoading(true);

    const { data, error } = await supabase
      .from("estoque_historico")
      .select("*")
      .order("criado_em", { ascending: false })
      .limit(300);

    setLoading(false);
    if (version !== sessionVersion || !state.user) return;

    if (error) {
      console.error(error);
      toast("Erro ao carregar o histórico.", "error");
      return;
    }

    const rows = data || [];

    ui.historyBody.innerHTML = rows.map((entry) => `
      <tr>
        <td>${formatDateTime(entry.criado_em)}</td>
        <td>${escapeHtml(entry.patrimonio || "—")}</td>
        <td>${historyActionBadge(entry.acao)}</td>
        <td>${escapeHtml(entry.campo_alterado || "—")}</td>
        <td>${escapeHtml(entry.valor_antigo ?? "—")}</td>
        <td>${escapeHtml(entry.valor_novo ?? "—")}</td>
        <td>${escapeHtml(entry.usuario_email || "sistema")}</td>
      </tr>
    `).join("");

    ui.historyEmpty.classList.toggle("hidden", rows.length !== 0);
    ui.historyBody.closest(".table-responsive").classList.toggle("hidden", rows.length === 0);

    openModal("history-modal");
  }

  function historyActionBadge(action) {
    const labels = {
      CRIACAO: ["Criação", "status-disponivel"],
      EDICAO: ["Edição", "status-em-uso"],
      EXCLUSAO: ["Exclusão", "status-descarte"]
    };

    const [label, cssClass] = labels[action] || [action || "—", "status-manutencao"];
    return `<span class="status-badge ${cssClass}">${escapeHtml(label)}</span>`;
  }

  /* =========================================================
     8. EXPORTAÇÃO CSV
     ========================================================= */

  async function exportCsv() {
    if (!await requireUser()) return;
    if (!state.filteredItems.length) {
      toast("Não há dados para exportar.", "warning");
      return;
    }

    const header = [
      "ID",
      "Patrimônio",
      "Nome",
      "Categoria",
      "Status",
      "Responsável",
      "Descrição",
      "Criado em",
      "Atualizado em"
    ];

    const rows = state.filteredItems.map((item) => [
      item.id,
      item.patrimonio,
      item.nome,
      item.categoria,
      item.status,
      item.responsavel || "",
      item.descricao || "",
      item.created_at || "",
      item.updated_at || ""
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map(csvCell).join(";"))
      .join("\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `estoque-ti-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    toast("Arquivo CSV exportado.", "success");
  }

  /* =========================================================
     9. TEMA
     ========================================================= */

  function restoreTheme() {
    let savedTheme;
    try { savedTheme = localStorage.getItem("estoque-ti-theme"); } catch {}
    if (savedTheme === "dark") document.body.classList.add("dark");
    updateThemeIcon();
  }

  function toggleTheme() {
    document.body.classList.toggle("dark");
    localStorage.setItem(
      "estoque-ti-theme",
      document.body.classList.contains("dark") ? "dark" : "light"
    );
    updateThemeIcon();
  }

  function updateThemeIcon() {
    const icon = $("#btn-darkmode i");
    if (!icon) return;
    icon.className = document.body.classList.contains("dark")
      ? "fa-solid fa-sun"
      : "fa-solid fa-moon";
  }

  /* =========================================================
     10. MODAIS
     ========================================================= */

  function openModal(id) {
    if (!state.user) return;
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal || modal.classList.contains("hidden")) return;
    modal.classList.add("hidden");

    const anyOpen = $$(".modal").some((item) => !item.classList.contains("hidden"));
    if (!anyOpen) document.body.style.overflow = "";
  }

  /* =========================================================
     11. UTILITÁRIOS
     ========================================================= */

  function validateItem(item) {
    if (!/^\d{5,7}$/.test(item.patrimonio)) {
      return "O patrimônio deve ter somente números e entre 5 e 7 dígitos.";
    }

    if (!item.nome || item.nome.length < 2) {
      return "Informe o nome do equipamento.";
    }

    if (!CATEGORIAS.includes(item.categoria)) {
      return "Selecione uma categoria válida.";
    }

    if (!STATUS.includes(item.status)) {
      return "Selecione um status válido.";
    }

    return null;
  }

  function emptyToNull(value) {
    const result = String(value || "").trim();
    return result ? result : null;
  }

  function compareValues(a, b) {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;

    const aText = String(a).toLocaleLowerCase("pt-BR");
    const bText = String(b).toLocaleLowerCase("pt-BR");
    return aText.localeCompare(bText, "pt-BR", { numeric: true });
  }

  function statusClass(status) {
    return {
      "Disponível": "status-disponivel",
      "Em Uso": "status-em-uso",
      "Manutenção": "status-manutencao",
      "Descarte": "status-descarte"
    }[status] || "status-manutencao";
  }

  function formatDate(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(new Date(value));
  }

  function formatDateTime(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  }

  function setLoading(visible) {
    ui.loading.classList.toggle("hidden", !visible);
    ui.loading.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function toast(message, type = "info") {
    const container = $("#toast-container");
    const item = document.createElement("div");
    const iconClass = {
      success: "fa-circle-check",
      error: "fa-circle-xmark",
      warning: "fa-triangle-exclamation",
      info: "fa-circle-info"
    }[type] || "fa-circle-info";

    item.className = `toast ${type}`;
    item.innerHTML = `<i class="fa-solid ${iconClass}"></i><p>${escapeHtml(message)}</p>`;
    container.appendChild(item);

    window.setTimeout(() => item.remove(), 4200);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function csvCell(value) {
    const text = String(value ?? "").replaceAll('"', '""');
    return `"${text}"`;
  }

  function translateAuthError(message = "") {
    const normalized = message.toLowerCase();

    if (normalized.includes("invalid login credentials")) {
      return "E-mail ou senha inválidos.";
    }

    if (normalized.includes("email not confirmed")) {
      return "Confirme seu e-mail antes de entrar ou procure o responsável pelo acesso.";
    }

    if (normalized.includes("rate") || normalized.includes("too many")) {
      return "Muitas tentativas. Aguarde um pouco antes de tentar novamente.";
    }
    return "Não foi possível entrar. Verifique sua conexão e tente novamente.";
  }

  function databaseErrorMessage(error) {
    if (error?.code === "23505") {
      return "Já existe um equipamento com esse patrimônio.";
    }

    if (error?.code === "23514") {
      return "Algum valor não atende às regras do banco de dados.";
    }

    return `Erro ao salvar: ${error?.message || "erro desconhecido"}`;
  }
})();
