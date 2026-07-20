-- The original duplicate-cluster backfill was applied before this source-signal
-- cascade was added. Preserve the force-hidden invariant for that exact cluster
-- without changing migration history.
update public.source_signals as signal
set
  public_status = 'hidden',
  promoted_at = null,
  promotion_reason = 'admin_force_hidden'
from public.issue_clusters as cluster
where signal.cluster_id = cluster.id
  and cluster.slug = 'auto-b7e557a13e9d'
  and cluster.admin_visibility_override = 'force_hidden';
