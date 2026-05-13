import {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

const BASE_URL_OPTIONS = [
  {
    name: 'IDST VFZ1',
    value: 'https://preme-genai-hub.preme-vfz1.con.idst.ibaintern.de/v1',
  },
  {
    name: 'IDST VFZ2',
    value: 'https://preme-genai-hub.preme-vfz2.con.idst.ibaintern.de/v1',
  },
];

export class CustomLmInternApi implements ICredentialType {
  name = 'customLmInternApi';
  displayName = 'Custom LLM Intern API';
  icon = 'fa:robot' as const;
  documentationUrl = 'https://docs.n8n.io/integrations/creating-nodes/';

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.token}}',
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL:
        '={{$credentials.baseUrlSource === "manual" ? $credentials.customBaseUrl : $credentials.baseUrlPreset}}',
      url: '/models',
      method: 'GET',
    },
  };

  properties: INodeProperties[] = [
    {
      displayName: 'Base URL Input',
      name: 'baseUrlSource',
      type: 'options',
      options: [
        { name: 'Select From List', value: 'list' },
        { name: 'Enter Manually', value: 'manual' },
      ],
      default: 'list',
    },
    {
      displayName: 'Base URL',
      name: 'baseUrlPreset',
      type: 'options',
      options: BASE_URL_OPTIONS,
      default: BASE_URL_OPTIONS[0].value,
      required: true,
      description: 'Wähle eine Base URL aus der hinterlegten Liste',
      displayOptions: {
        show: { baseUrlSource: ['list'] },
      },
    },
    {
      displayName: 'Base URL',
      name: 'customBaseUrl',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'https://your-vllm-endpoint.com/v1',
      description: 'Gib die Base URL manuell ein',
      displayOptions: {
        show: { baseUrlSource: ['manual'] },
      },
    },
    {
      displayName: 'Bearer Token / API Key',
      name: 'token',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description: 'Dein Bearer Token oder API Key',
    },
  ];
}
