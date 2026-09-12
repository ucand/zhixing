alter table note add column if not exists color varchar(7);
alter table note add constraint note_color_format_chk check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
