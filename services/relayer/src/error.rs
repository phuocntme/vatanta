//! API error codes (stable, documented in SPEC.md §6).
use axum::{http::StatusCode, response::IntoResponse, Json};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("proof is bound to relayer {0}, not this relayer")]
    WrongRelayer(String),
    #[error("fee must be exactly {0} micro-USDC")]
    WrongFee(String),
    #[error("simulation reverted: {0}")]
    Rejected(String),
    #[error("batch {0} is not a valid future batch boundary")]
    BadBatch(i64),
    #[error("payment required")]
    PaymentRequired(serde_json::Value),
    #[error("not found")]
    NotFound,
    /// RPC unreachable / timed out: the request may be retried, the chain did not reject it.
    #[error("upstream RPC error: {0}")]
    Upstream(String),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl ApiError {
    pub fn code(&self) -> &'static str {
        match self {
            ApiError::BadRequest(_) => "bad_request",
            ApiError::WrongRelayer(_) => "wrong_relayer",
            ApiError::WrongFee(_) => "wrong_fee",
            ApiError::Rejected(_) => "rejected",
            ApiError::BadBatch(_) => "bad_batch",
            ApiError::PaymentRequired(_) => "payment_required",
            ApiError::NotFound => "not_found",
            ApiError::Upstream(_) => "upstream",
            ApiError::Internal(_) => "internal",
        }
    }

    /// True when retrying later can succeed (network trouble), false when the chain said no.
    pub fn is_transient(&self) -> bool {
        matches!(self, ApiError::Upstream(_) | ApiError::Internal(_))
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            ApiError::PaymentRequired(_) => StatusCode::PAYMENT_REQUIRED,
            ApiError::NotFound => StatusCode::NOT_FOUND,
            ApiError::Rejected(_) => StatusCode::UNPROCESSABLE_ENTITY,
            ApiError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
            ApiError::Upstream(_) => StatusCode::BAD_GATEWAY,
            _ => StatusCode::BAD_REQUEST,
        };
        if let ApiError::PaymentRequired(req) = &self {
            let mut body = req.clone();
            body["error"] = json!({"code": "payment_required", "message": "attach a proof whose public fee pays this relayer"});
            return (status, [("x-payment-required", "vatanta-note")], Json(body)).into_response();
        }
        if let ApiError::Internal(e) = &self {
            tracing::error!("internal error: {e:#}");
        }
        (status, Json(json!({"error": {"code": self.code(), "message": self.to_string()}}))).into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
