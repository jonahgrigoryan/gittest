import os

def fix_main():
    path = 'packages/orchestrator/src/main.ts'
    with open(path, 'r') as f:
        content = f.read()
    
    # 1. Update imports
    if 'import { createConfigManager }' in content:
        content = content.replace('import { createConfigManager }', 'import { createConfigManager, ConfigurationManager }')
    
    # 2. Replace usage
    old_usage = """configManager: (useMockAgents
        ? createMockConfigProxy(configManager, agentModelsConfig)
        : // eslint-disable-next-line @typescript-eslint/no-explicit-any
          configManager) as any,"""
    new_usage = """configManager: useMockAgents
        ? createMockConfigProxy(configManager, agentModelsConfig)
        : configManager,"""
    content = content.replace(old_usage, new_usage)
    
    # 3. Replace function
    old_func = """function createMockConfigProxy(
  configManager: { get: <T>(key: string) => T },
  injectedModels: AgentModelConfig[],
): { get: <T>(key: string) => T } {
  return {
    get: <T>(key: string): T => {
      if (key === "agents.models") {
        return injectedModels as T;
      }
      return configManager.get<T>(key);
    },
  };
}"""
    new_func = """function createMockConfigProxy(
  configManager: ConfigurationManager,
  injectedModels: AgentModelConfig[],
): ConfigurationManager {
  return new Proxy(configManager, {
    get(target, prop, receiver) {
      if (prop === "get") {
        return <T>(key: string): T => {
          if (key === "agents.models") {
            return injectedModels as unknown as T;
          }
          return target.get<T>(key);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}"""
    content = content.replace(old_func, new_func)
    
    with open(path, 'w') as f:
        f.write(content)
    print(f"Fixed {path}")

def fix_replay():
    path = 'packages/orchestrator/src/cli/replay.ts'
    with open(path, 'r') as f:
        content = f.read()
    
    # 1. Update imports
    if 'import { createConfigManager }' in content:
        content = content.replace('import { createConfigManager }', 'import { createConfigManager, ConfigurationManager }')
    
    # 2. Replace usage
    old_usage = """configManager: (useMockAgents
          ? createMockConfigProxy(configManager, agentModels)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          : configManager) as any,"""
    new_usage = """configManager: useMockAgents
          ? createMockConfigProxy(configManager, agentModels)
          : configManager,"""
    content = content.replace(old_usage, new_usage)
    
    # 3. Replace function
    old_func = """function createMockConfigProxy(
  configManager: { get: <T>(key: string) => T },
  injectedModels: AgentModelConfig[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return {
    get: <T>(key: string): T => {
      if (key === "agents.models") {
        return injectedModels as T;
      }
      return configManager.get<T>(key);
    }
  };
}"""
    new_func = """function createMockConfigProxy(
  configManager: ConfigurationManager,
  injectedModels: AgentModelConfig[],
): ConfigurationManager {
  return new Proxy(configManager, {
    get(target, prop, receiver) {
      if (prop === "get") {
        return <T>(key: string): T => {
          if (key === "agents.models") {
            return injectedModels as unknown as T;
          }
          return target.get<T>(key);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}"""
    content = content.replace(old_func, new_func)
    
    with open(path, 'w') as f:
        f.write(content)
    print(f"Fixed {path}")

if __name__ == '__main__':
    fix_main()
    fix_replay()
