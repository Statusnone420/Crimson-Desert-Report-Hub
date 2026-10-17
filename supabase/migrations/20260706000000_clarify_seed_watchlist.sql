update issue_clusters
set
  description = 'Watchlist item for frame-rate drops, stutter, and frame-pacing issues after patch 1.13.00. It remains unverified until approved reports or public signals confirm it.'
where slug = 'performance_regression' and confidence = 'seed_unverified';

update issue_clusters
set
  description = 'Watchlist item for crashes to desktop/home and launch hangs after patch 1.13.00. It remains unverified until approved reports or public signals confirm it.'
where slug = 'crash_startup_hang' and confidence = 'seed_unverified';

update issue_clusters
set
  title = 'Map-open crash after claimed fix',
  description = 'Official patch notes mention a claimed map-crash fix. This watchlist item waits for current evidence before marking the issue persistent.',
  fix_status = 'fix_claimed'
where slug = 'map_open_crash_persistent' and confidence = 'seed_unverified';

update issue_clusters
set
  title = 'Boss rematch crash after claimed fix',
  description = 'Official patch notes mention a claimed boss-rematch crash fix. This watchlist item waits for current evidence before marking the issue persistent.',
  fix_status = 'fix_claimed'
where slug = 'boss_rematch_crash_persistent' and confidence = 'seed_unverified';

update issue_clusters
set
  description = 'Watchlist item for horse/mount control failures, unresponsive inputs, and title-screen lockups. It remains unverified until approved reports or public signals confirm it.'
where slug = 'controls_input_gameplay' and confidence = 'seed_unverified';

update issue_clusters
set
  description = 'Watchlist item for hardware- or driver-specific performance reports, including GPU and driver combinations. It remains unverified until approved reports or public signals confirm it.'
where slug = 'hardware_driver_specific' and confidence = 'seed_unverified';
