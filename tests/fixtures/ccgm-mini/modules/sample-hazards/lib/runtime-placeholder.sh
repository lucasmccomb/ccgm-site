#!/usr/bin/env bash
# Self-substituting at runtime, NOT by the installer: template is false in
# module.json, so this __RUNTIME_VAR__-shaped text must NOT be flagged as
# hasSubstitutionPlaceholders even though it matches the placeholder regex.
echo "${RUNTIME_VAR:-__RUNTIME_VAR__}"
