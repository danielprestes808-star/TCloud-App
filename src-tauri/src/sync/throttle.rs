//! Simple cooperative bandwidth limiter for TCloud transfers.

use std::time::{Duration, Instant};

pub struct BandwidthThrottle {
    limit_bps: u64,
    started_at: Instant,
    transferred: u64,
}

impl BandwidthThrottle {
    pub fn new(limit_bps: u64) -> Self {
        Self {
            limit_bps,
            started_at: Instant::now(),
            transferred: 0,
        }
    }

    pub fn set_transferred(&mut self, bytes: u64) {
        self.transferred = bytes;
        self.started_at = Instant::now()
            .checked_sub(Duration::from_secs_f64(if self.limit_bps > 0 {
                bytes as f64 / self.limit_bps as f64
            } else {
                0.0
            }))
            .unwrap_or_else(Instant::now);
    }

    pub async fn account(&mut self, bytes: u64) {
        if self.limit_bps == 0 {
            return;
        }

        self.transferred = self.transferred.saturating_add(bytes);
        let expected = Duration::from_secs_f64(self.transferred as f64 / self.limit_bps as f64);
        let elapsed = self.started_at.elapsed();

        if expected > elapsed {
            tokio::time::sleep(expected - elapsed).await;
        }
    }
}
