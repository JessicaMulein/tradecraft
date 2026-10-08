"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAnalyticsEnabled = isAnalyticsEnabled;
/**
 * Analytics are opt-in: both `"analytics": false` and an unset flag mean no
 * event is ever sent. Anything enabled for the sake of analytics (network
 * allowlists, endpoints) gates on this, not on an explicit opt-out alone.
 */
function isAnalyticsEnabled(nxJson) {
    return nxJson?.analytics === true;
}
