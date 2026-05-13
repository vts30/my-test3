import {
  INodeType,
  INodeTypeDescription,
  ISupplyDataFunctions,
  NodeConnectionType,
  SupplyData,
} from 'n8n-workflow';
import { ChatOpenAI } from '@langchain/openai';

export class PremeGenAIHub implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'PreMe GenAI Hub',
    name: 'premeGenAiHub',
    icon: 'fa:robot',
    group: ['transform'],
    version: 1,
    description: 'Use PreMe GenAI Hub (vLLM) as a language model in AI Agent',
    defaults: { name: 'PreMe GenAI Hub' },
    codex: {
      categories: ['AI'],
      subcategories: {
        AI: ['Language Models', 'Root Nodes'],
      },
      resources: {},
    },
    inputs: [],
    outputs: [NodeConnectionType.AiLanguageModel],
    outputNames: ['Model'],
    properties: [
      {
        displayName: 'Base URL',
        name: 'baseUrl',
        type: 'string',
        default: 'http://vllm-stack-router-service.preme-genai-hub.svc.cluster.local/v1',
        description: 'vLLM endpoint base URL (without /chat/completions)',
      },
      {
        displayName: 'Model',
        name: 'model',
        type: 'string',
        default: 'Mistral-Nemo-Instruct-2407',
        description: 'Model name as registered on the vLLM server',
      },
      {
        displayName: 'Temperature',
        name: 'temperature',
        type: 'number',
        typeOptions: { minValue: 0, maxValue: 2, numberStepSize: 0.05 },
        default: 0.2,
        description: 'Controls randomness — lower = more deterministic',
      },
      {
        displayName: 'Max Tokens',
        name: 'maxTokens',
        type: 'number',
        typeOptions: { minValue: 1 },
        default: 1500,
        description: 'Maximum tokens in the response',
      },
      {
        displayName: 'Top P',
        name: 'topP',
        type: 'number',
        typeOptions: { minValue: 0, maxValue: 1, numberStepSize: 0.05 },
        default: 0.9,
        description: 'Nucleus sampling threshold',
      },
    ],
  };

  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    const baseUrl = this.getNodeParameter('baseUrl', itemIndex) as string;
    const model = this.getNodeParameter('model', itemIndex) as string;
    const temperature = this.getNodeParameter('temperature', itemIndex) as number;
    const maxTokens = this.getNodeParameter('maxTokens', itemIndex) as number;
    const topP = this.getNodeParameter('topP', itemIndex) as number;

    const llm = new ChatOpenAI({
      model,
      temperature,
      maxTokens,
      topP,
      apiKey: 'no-auth',
      configuration: {
        baseURL: baseUrl,
        // Strip Authorization header so server receives no auth — same as HTTP node with Authentication: None
        fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
          const headers = new Headers(init?.headers as HeadersInit);
          headers.delete('authorization');
          return fetch(url, { ...init, headers });
        },
      },
    });

    return { response: llm };
  }
}
