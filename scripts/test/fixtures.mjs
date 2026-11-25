// Fixtures shared by the tests and the browser QA script. They copy the shapes the live services returned on 2026-11-24.
export const NOW = new Date('2026-11-24T20:00:00Z');

/* ----------------------------------------------------------------- fixtures */

export const fires = {
  features: [
    { attributes: { FIRE_NUMBER: 'N21446', INCIDENT_NAME: 'N21446', FIRE_STATUS: 'Out', CURRENT_SIZE: 0.6 } },
    {
      attributes: {
        FIRE_NUMBER: 'C32392', INCIDENT_NAME: 'C32392', FIRE_STATUS: 'Under Control', CURRENT_SIZE: 0.5,
        FIRE_OF_NOTE_IND: 'N', FIRE_URL: 'https://wildfiresituation.nrs.gov.bc.ca/incidents?fireYear=2026&incidentNumber=C32392',
        GEOGRAPHIC_DESCRIPTION: 'S of Little Gavin Lake', LATITUDE: 52.4861, LONGITUDE: -121.7725, IGNITION_DATE: 1794611310000,
      },
    },
    {
      attributes: {
        FIRE_NUMBER: 'K70001', INCIDENT_NAME: 'Example Creek', FIRE_STATUS: 'Out of Control', CURRENT_SIZE: 1200,
        FIRE_OF_NOTE_IND: 'Y', LATITUDE: 50.1, LONGITUDE: -120.2,
      },
    },
  ],
};

export const evac = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-120, 50], [-120, 51], [-119, 51], [-120, 50]]] },
      properties: {
        EMRG_OAA_SYSID: 1, EVENT_NAME: '2898 Durrell Road Landslide', EVENT_TYPE: 'Landslide', ORDER_ALERT_NAME: 'Splatsin Kukpi7 & Tkwamipla',
        ORDER_ALERT_STATUS: 'Alert', ISSUING_AGENCY: 'Cariboo Regional District', DATE_MODIFIED: Date.parse('2022-08-24T16:00:00Z'),
        EVENT_START_DATE: 1620907200000, MULTI_SOURCED_HOMES: 1, MULTI_SOURCED_POPULATION: 0,
      },
    },
    {
      type: 'Feature', geometry: null,
      properties: { EMRG_OAA_SYSID: 2, EVENT_NAME: 'Flood', EVENT_TYPE: 'Flood', ORDER_ALERT_NAME: 'Area B', ORDER_ALERT_STATUS: 'Order', DATE_MODIFIED: Date.parse('2026-11-24T18:00:41Z') },
    },
    { type: 'Feature', geometry: null, properties: { EMRG_OAA_SYSID: 3, ORDER_ALERT_NAME: 'Area C', ORDER_ALERT_STATUS: 'All Clear' } },
  ],
};

export const OFFICIAL_TEXT = 'This statement is in effect.\n\nWhat:\nCoastal flooding.\n\nWhen:\nDuring high tides.';
export const eccc = {
  features: [
    {
      id: 'a1', geometry: { type: 'Polygon', coordinates: [[[-123, 49], [-123, 49.1], [-122.9, 49.1], [-123, 49]]] },
      properties: { alert_type: 'statement', alert_name_en: 'coastal flooding statement', feature_name_en: 'Boundary Bay', province: 'BC', status_en: 'continued',
        alert_text_en: OFFICIAL_TEXT, publication_datetime: '2026-11-24T23:48:59.503Z', expiration_datetime: '2026-11-25T15:48:59.503Z' },
    },
    { id: 'a2', geometry: null, properties: { alert_type: 'warning', alert_name_en: 'rainfall warning', feature_name_en: 'North Shore', province: 'BC', risk_colour_en: 'orange' } },
    { id: 'a3', geometry: null, properties: { alert_type: 'warning', alert_name_en: 'wind warning', feature_name_en: 'Howe Sound', province: 'BC', risk_colour_en: 'red' } },
    { id: 'a4', geometry: null, properties: { alert_type: 'warning', alert_name_en: 'snowfall warning', feature_name_en: 'Banff', province: 'AB' } },
    { id: 'a5', geometry: null, properties: { alert_type: 'ended', alert_name_en: 'old', feature_name_en: 'X', province: 'BC' } },
    { id: 'a6', geometry: null, properties: { alert_type: 'watch', alert_name_en: 'tornado watch', feature_name_en: 'Y', province: 'BC' } },
  ],
};

export const aqhi = {
  features: [
    { geometry: { type: 'Point', coordinates: [-123.4, 48.4] }, properties: { location_id: 'JCLMX', location_name_en: 'WestShore', aqhi: 1, observation_datetime: '2026-11-24T20:00:00Z', special_notes_en: '' } },
    { geometry: { type: 'Point', coordinates: [-122, 49] }, properties: { location_id: 'AAA', location_name_en: 'Mid Station', aqhi: 4.62, observation_datetime: '2026-11-24T20:00:00Z' } },
    { geometry: { type: 'Point', coordinates: [-121, 50] }, properties: { location_id: 'BBB', location_name_en: 'Smoky Station', aqhi: 8, observation_datetime: '2026-11-24T20:00:00Z', special_notes_en: 'Wildfire smoke' } },
    { geometry: null, properties: { location_id: 'CCC', location_name_en: 'No Data', aqhi: null } },
  ],
};

export const roads = {
  events: [
    {
      id: 'drivebc.ca/DBC-1', status: 'ACTIVE', severity: 'MAJOR', headline: 'INCIDENT', created: '2026-07-14T14:44:12-07:00', updated: '2026-09-15T20:06:44-07:00',
      description: 'Washout at Silver Skagit Road, In Hope. Last update: September 15th, 2026 at 8:01pm PDT. Road has been impacted by washout.',
      roads: [{ name: 'Silver Skagit Road' }], areas: [{ name: 'Fraser Valley District' }], geography: { type: 'Point', coordinates: [-121.1, 49.1] },
    },
    { id: 'drivebc.ca/DBC-2', status: 'ARCHIVED', severity: 'MINOR', description: 'Old.' },
  ],
};

/* ----------------------------------------------------------------- normalizers */

