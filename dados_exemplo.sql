-- OPCIONAL: apenas para demonstração; adiciona três equipamentos e histórico.
insert into public.estoque
    (patrimonio, nome, categoria, status, responsavel, descricao)
values
    ('10001', 'Notebook Dell Latitude', 'Notebook', 'Em Uso', 'João Silva', 'Notebook do setor administrativo'),
    ('10002', 'Monitor LG 24 polegadas', 'Monitor', 'Disponível', null, 'Monitor Full HD'),
    ('10003', 'Switch TP-Link 24 portas', 'Switch', 'Manutenção', 'Equipe de TI', 'Equipamento em análise técnica')
on conflict (patrimonio) do nothing;

