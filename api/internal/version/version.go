package version

import "fmt"

// V1 is the URL prefix for API version 1.
const V1 = "/v1"

// Route returns the full route path for a given API version and path.
func Route(apiVersion, path string) string {
	return apiVersion + path
}

// SchemaVersion represents the version of the span schema stored in ClickHouse.
type SchemaVersion int

const (
	// SchemaV1 is the only span schema version ever written. Every change since
	// (error_type/error_message, content & tools, kind) has been additive, and
	// additive changes do not bump the version: an old row simply reads back
	// zero-values for columns it predates. The collector stamps this value on
	// every span it writes.
	SchemaV1 SchemaVersion = 1

	// CurrentSchema is the newest schema version this server can interpret.
	// It must always equal what the collector stamps — bump both together, and
	// only for a breaking change (a renamed, removed or retyped field).
	CurrentSchema SchemaVersion = SchemaV1
)

// IsCompatible returns true if rowVersion is compatible with the current server schema.
// A row is compatible if its version is at most the current schema version.
// A row with a higher version than the server knows about is not compatible.
func IsCompatible(rowVersion SchemaVersion) bool {
	return rowVersion <= CurrentSchema
}

// CompatibilityError is returned when a row has a schema version higher than the server supports.
type CompatibilityError struct {
	RowVersion    SchemaVersion
	ServerVersion SchemaVersion
}

func (e *CompatibilityError) Error() string {
	return fmt.Sprintf("incompatible schema version: row has version %d, server supports up to %d", e.RowVersion, e.ServerVersion)
}
