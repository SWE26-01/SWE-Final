# Extension of SmartHome: Internal & External Connectivity via A2A

**One-Sentence Description**

A platform that enables users to create, discover, and connect autonomous agents through natural language, facilitating decentralized collaboration and seamless communication via the A2A protocol.

## 1. Background & Problem Definition

최근 LLM 기반 AI Agent가 다양한 서비스와 환경에 도입되고 있지만, 개별 에이전트를 생성하고 서로 연결하여 협업하도록 구성하는 과정에는 여전히 기술적 복잡성이 존재한다.

특히 기존 에이전트 시스템은 다음과 같은 한계를 가진다.

- **Agent Creation Complexity:** 에이전트 생성 및 배포를 위해 프레임워크, API, 실행 환경 등에 대한 기술적 이해가 필요하다.
- **Limited Interoperability:** 서로 다른 환경에서 개발된 에이전트를 발견하고 연결하기 어려우며, 서비스마다 별도의 통합 작업이 필요하다.
- **Centralized Architecture:** 중앙 오케스트레이터에 의존하는 구조에서는 개별 에이전트의 독립성과 권한 분리가 제한될 수 있다.

따라서 사용자가 손쉽게 에이전트를 생성하고, 독립적인 에이전트들이 표준화된 방식으로 연결 및 협업할 수 있는 플랫폼이 필요하다.

## 2. Proposed Solution

본 프로젝트에서는 **A2A(Agent-to-Agent) 프로토콜 기반의 Agent Studio와 Agent Hub를 통합한 플랫폼**을 제안한다.

**① Agent Studio — Natural Language-Based Agent Creation**

사용자는 자연어로 원하는 에이전트의 역할과 기능을 설명하고, 플랫폼은 이를 기반으로 에이전트를 자동 생성한다. LangChain을 활용해 자연어 요구사항을 구조화하고, 플랫폼이 제공하는 Skill(에이전트가 사용할 수 있는 기능)을 조합해 에이전트를 구성 및 배포한다. 생성된 에이전트는 Python 기반 공통 실행기에서 동작하며, 사용자와 채팅으로 대화하는 부분은 OpenClaw를 사용한다.

**② Agent Hub — Agent Discovery & Connectivity**

생성된 에이전트는 Hub에 등록되며, 사용자는 다른 에이전트를 검색하고 연결할 수 있다. A2A Agent Card를 활용하여 에이전트의 기능과 통신 인터페이스를 확인하고, 서로 다른 실행 환경에 있는 에이전트 간 협업을 지원한다.

**③ A2A-Based Decentralized Collaboration**

각 에이전트는 독립적인 실행 환경과 권한을 유지하면서 A2A를 통해 작업을 요청하고 결과를 교환한다. 이를 통해 중앙 시스템에 모든 기능과 데이터 접근 권한을 집중시키지 않고도 여러 에이전트가 협업할 수 있다.

## 3. Expected Scenario & Contribution

**Main Scenario — Agent Creation & Collaboration**

1. 사용자가 자연어로 새로운 에이전트의 역할과 기능을 정의한다.
2. Agent Studio가 필요한 Skill을 조합하여 에이전트를 생성한다.
3. 생성된 에이전트가 Agent Hub에 등록된다.
4. 사용자가 Hub에서 다른 에이전트를 검색하고 연결한다.
5. 연결된 에이전트들이 A2A를 통해 작업을 위임하고 협업한다.

**Extended Scenario — Smart Hospital**

플랫폼을 병원 환경으로 확장하면 심장내과, 정형외과, 병실별 에이전트를 독립적으로 구성할 수 있다. 각 에이전트는 센서 및 외부 시스템과 연결되며, A2A를 통해 병실 상태 확인, 병실 준비, 부서 간 업무 요청 등을 수행할 수 있다.

**Expected Contributions**

- 자연어 기반 에이전트 생성으로 개발 및 구성 복잡성 감소
- A2A 기반 에이전트 검색·연결·협업을 통한 상호운용성 확보
- 독립적인 실행 환경과 권한 분리를 통한 분산형 협업 지원
- Skill 조합과 동적 에이전트 추가를 통한 시스템 확장성 향상

궁극적으로 본 프로젝트는 **사용자가 에이전트를 직접 생성하고, 서로 다른 에이전트들을 연결하여 하나의 협업 환경을 구성할 수 있는 통합 플랫폼**을 구현하는 것을 목표로 한다.
