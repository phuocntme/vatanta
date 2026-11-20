-- The pool this database's rows belong to. A deployment with another pool (redeploy) wipes the data.
create table if not exists meta (key text primary key, value text not null);
