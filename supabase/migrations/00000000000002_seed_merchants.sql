alter table merchants add constraint merchants_name_key unique (name);

insert into merchants (name, base_url) values
  ('Travis Perkins', 'https://www.travisperkins.co.uk'),
  ('Screwfix', 'https://www.screwfix.com'),
  ('Toolstation', 'https://www.toolstation.com'),
  ('Jewson', 'https://www.jewson.co.uk')
on conflict (name) do nothing;
