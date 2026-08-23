package model

// Page is the standard envelope for list endpoints. The dashboard reads
// `items`, so the slice must serialize as [] (never null) when empty.
type Page struct {
	Items    any `json:"items"`
	Total    int `json:"total"`
	Page     int `json:"page"`
	PageSize int `json:"page_size"`
}
