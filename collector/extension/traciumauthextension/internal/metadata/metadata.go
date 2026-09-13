// Package metadata carries the component identity for the Tracium ingest-auth
// extension, kept in its own package to mirror the layout OpenTelemetry's
// generated components use.
package metadata

import "go.opentelemetry.io/collector/component"

// Type is the component type referenced in collector config
// (extensions.traciumauth, auth: { authenticator: traciumauth }).
var Type = component.MustNewType("traciumauth")

// ExtensionStability is the stability level advertised to the collector.
const ExtensionStability = component.StabilityLevelBeta
