import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BedDouble,
  Bot,
  BrainCircuit,
  ChevronRight,
  CircleDot,
  CookingPot,
  Flame,
  Lightbulb,
  Monitor,
  Moon,
  Pause,
  Play,
  Power,
  ShieldCheck,
  ShowerHead,
  SlidersHorizontal,
  Sofa,
  Sun,
  Droplets,
  RotateCcw,
  Thermometer,
  Tv,
  Volume2,
  WashingMachine,
  Wifi,
  Wind,
  X,
} from 'lucide-react';
import Home3D from './Home3D';
import './styles.css';

const initialRooms = [
  {
    id: 'kitchen', name: '주방', en: 'Kitchen', className: 'room-kitchen', icon: CookingPot,
    temp: 25.2, humidity: 51, description: '조리 환경과 안전 센서를 관리하는 공간',
    devices: [
      { id: 'kitchen-light', name: '조리대 조명', type: 'light', on: false, value: '꺼짐' },
      { id: 'kitchen-stove', name: '화구', type: 'stove', on: false, value: '꺼짐' },
      { id: 'kitchen-air', name: '환기 시스템', type: 'air', on: true, value: '자동 환기 중' },
      { id: 'kitchen-hood', name: '주방 후드', type: 'hood', on: false, value: '대기 중' },
    ],
  },
  {
    id: 'dining', name: '다이닝', en: 'Dining', className: 'room-dining', icon: CookingPot,
    temp: 24.5, humidity: 47, description: '식사와 가족 활동을 위한 공간',
    devices: [
      { id: 'dining-light', name: '식탁 조명', type: 'light', on: true, value: '웜 화이트 · 55%' },
    ],
  },
  {
    id: 'living',
    name: '거실',
    en: 'Living Room',
    className: 'room-living',
    icon: Sofa,
    temp: 24.1,
    humidity: 48,
    description: '가족 활동과 미디어를 위한 중심 공간',
    devices: [
      { id: 'living-light', name: '무드 조명', type: 'light', on: true, value: '웜 화이트 · 45%' },
      { id: 'living-air', name: '에어컨', type: 'air', on: true, value: '24°C · 약풍' },
      { id: 'living-cleaner', name: '로봇 청소기', type: 'cleaner', on: false, value: '충전 중 · 86%' },
      { id: 'living-tv', name: 'TV', type: 'tv', on: false, value: '대기 중' },
      { id: 'living-purifier', name: '공기청정기', type: 'purifier', on: true, value: '자동 · 공기질 좋음' },
    ],
  },
  {
    id: 'veranda', name: '베란다', en: 'Veranda', className: 'room-veranda', icon: Sun,
    temp: 22.8, humidity: 55, description: '채광과 외부 공기 상태를 확인하는 공간',
    devices: [
      { id: 'veranda-light', name: '베란다 조명', type: 'light', on: false, value: '꺼짐' },
      { id: 'veranda-washer', name: '세탁기', type: 'washer', on: false, value: '대기 중' },
    ],
  },
  {
    id: 'bath1', name: '욕실 1', en: 'Bath 1', className: 'room-bath1', icon: ShowerHead,
    temp: 24.4, humidity: 60, description: '공용 욕실의 습도와 환기를 관리하는 공간',
    devices: [
      { id: 'bath1-light', name: '천장 조명', type: 'light', on: false, value: '꺼짐' },
      { id: 'bath1-air', name: '환풍기', type: 'air', on: true, value: '습도 감지 · 자동' },
    ],
  },
  {
    id: 'bedroom1', name: '침실 1', en: 'Bedroom 1', className: 'room-bedroom1', icon: BedDouble,
    temp: 23.8, humidity: 46, description: '수면과 휴식을 위한 메인 침실',
    devices: [
      { id: 'bedroom1-light', name: '메인 조명', type: 'light', on: true, value: '밝기 30%' },
      { id: 'bedroom1-air', name: '에어컨', type: 'air', on: true, value: '24°C · 자동' },
      { id: 'bedroom1-curtain', name: '스마트 커튼', type: 'curtain', on: false, value: '닫힘' },
      { id: 'bedroom1-humidifier', name: '가습기', type: 'humidifier', on: true, value: '자동 · 46%' },
    ],
  },
  {
    id: 'bedroom2', name: '침실 2', en: 'Bedroom 2', className: 'room-bedroom2', icon: BedDouble,
    temp: 24.0, humidity: 45, description: '개인 생활과 휴식을 위한 침실',
    devices: [
      { id: 'bedroom2-light', name: '메인 조명', type: 'light', on: false, value: '꺼짐' },
      { id: 'bedroom2-air', name: '에어컨', type: 'air', on: false, value: '대기 중' },
      { id: 'bedroom2-humidifier', name: '가습기', type: 'humidifier', on: false, value: '대기 중' },
    ],
  },
  {
    id: 'bath2', name: '욕실 2', en: 'Bath 2', className: 'room-bath2', icon: ShowerHead,
    temp: 24.6, humidity: 62, description: '침실 구역의 습도와 환기를 관리하는 공간',
    devices: [
      { id: 'bath2-light', name: '천장 조명', type: 'light', on: false, value: '꺼짐' },
      { id: 'bath2-air', name: '환풍기', type: 'air', on: true, value: '습도 감지 · 자동' },
    ],
  },
  {
    id: 'bedroom3', name: '침실 3', en: 'Bedroom 3', className: 'room-bedroom3', icon: BedDouble,
    temp: 23.6, humidity: 44, description: '독립적인 환경 제어가 가능한 침실',
    devices: [
      { id: 'bedroom3-light', name: '메인 조명', type: 'light', on: true, value: '밝기 45%' },
      { id: 'bedroom3-air', name: '에어컨', type: 'air', on: false, value: '대기 중' },
      { id: 'bedroom3-humidifier', name: '가습기', type: 'humidifier', on: true, value: '자동 · 44%' },
      { id: 'bedroom3-pc', name: '데스크톱 PC', type: 'pc', on: true, value: '작업 세션 감지 중' },
    ],
  },
];

const createTestRooms = () => initialRooms.map((room, index) => ({
  ...room,
  devices: room.devices.map((device) => ({ ...device })),
  noise: [38, 42, 36, 31, 44, 32, 35, 46, 33][index],
}));

const testLimits = {
  temp: 26,
  humidity: 60,
  noise: 55,
};

const baseLogs = [
  { time: '22:32:08', from: 'Desktop Agent', to: 'Home Agent', text: 'PC 활동 종료·취침 일정 맥락 전달', color: 'purple' },
  { time: '22:32:09', from: 'Home Agent', to: 'My Room Agent', text: '수면 환경 준비 요청', color: 'blue' },
  { time: '22:32:10', from: 'My Room Agent', to: 'Home Agent', text: '조명 30%·냉방 24°C 적용 완료', color: 'green' },
];

const agentRoleMap = {
  'Kitchen Agent': 'Home Agent', 'Context Agent': 'Home Agent', 'Comfort Agent': 'Home Agent', 'Sleep Agent': 'Home Agent', 'Away Agent': 'Home Agent', 'Prediction Agent': 'Home Agent',
  'Device Agent': 'My Room Agent', 'Climate Agent': 'My Room Agent', 'Cleaning Agent': 'My Room Agent', 'Light Agent': 'My Room Agent', 'Energy Agent': 'My Room Agent',
  'Presence Agent': 'Mobile Agent', 'Motion Agent': 'Mobile Agent', 'Sensor Agent': 'Mobile Agent',
};

const agentRole = (name) => agentRoleMap[name] || name;

const simulationScenarios = [
  {
    id: 1, label: 'SIMULATION 1', title: '요리부터 취침까지', duration: 20, confidence: 96,
    steps: [
      { at: 0, phase: 'SENSOR', title: '조리 종료 감지', detail: '주방 열원 감소와 조리 패턴으로 요리 종료를 감지했습니다.', from: 'Kitchen Agent', to: 'Context Agent', message: '조리 종료·주방 재실 신호 전달', occupant: 'kitchen', sensor: '조리 종료 감지', roomUpdates: [{ roomId: 'kitchen', temp: 27.1, humidity: 57 }] },
      { at: 2, phase: 'PREDICT', title: '거실 휴식 예측', detail: '사용자가 식사 후 거실에서 휴식할 가능성 92%를 예측했습니다.', from: 'Context Agent', to: 'Comfort Agent', message: '거실 휴식 가능성 92% · 데모 예측', occupant: 'living', sensor: '휴식 패턴 분석' },
      { at: 5, phase: 'ACTION', title: '휴식·환기 환경 실행', detail: '거실 휴식 환경과 주방 환기, 욕실 2 습도 조절을 함께 실행합니다.', from: 'Comfort Agent', to: 'Device Agent', message: '휴식·환기·욕실 습도 제어 명령', sensor: '휴식 환경 제어 중', commands: [
        ['living', 'living-light', true, '밝기 60%'], ['living', 'living-air', true, '24°C · 자동'], ['kitchen', 'kitchen-hood', true, '강풍 · 조리 후 환기'], ['kitchen', 'kitchen-air', true, '강제 환기 중'], ['living', 'living-purifier', true, '강풍 · 공기질 개선'], ['bath2', 'bath2-air', true, '습도 조절 중'],
      ] },
      { at: 8, phase: 'VERIFY', title: '주방 비움·완만한 환기 진행', detail: '주방이 비어 청소를 시작하고, 환기를 유지해 온도와 습도를 천천히 낮춥니다.', from: 'Presence Agent', to: 'Cleaning Agent', message: '주방 비움 확인 · 완만한 환기·청소 진행', sensor: '주방 환경 회복 중', commands: [['living', 'living-cleaner', true, '주방 구역 청소 중']], roomUpdates: [{ roomId: 'kitchen', temp: 25.4, humidity: 52 }], environmentDuration: 11000 },
      { at: 10, phase: 'SENSOR', title: '침실 이동 감지', detail: '거실에서 침실 1로 이동하는 사용자를 감지했습니다.', from: 'Motion Agent', to: 'Context Agent', message: '침실 이동·재실 신호 전달', occupant: 'bedroom1', sensor: '침실 이동 감지' },
      { at: 13, phase: 'PREDICT', title: '취침 가능성 예측', detail: 'Desktop Agent의 PC 활동 종료와 일정 맥락을 기반으로 취침 가능성 96%를 예측했습니다.', from: 'Desktop Agent', to: 'Home Agent', message: 'PC 활동 종료·취침 일정 · 가능성 96% · 데모 예측', sensor: '취침 패턴 분석' },
      { at: 16, phase: 'ACTION', title: '수면 환경 준비', detail: '침실 1을 제외한 모든 조명과 에어컨을 끄고, 침실 조명 30%, 냉방 24°C와 수면 모드를 실행합니다.', from: 'Sleep Agent', to: 'Device Agent', message: '전체 소등·냉방 종료 및 수면 환경 기기 제어 명령', sensor: '수면 환경 제어 중', commands: [
        ['bedroom1', 'bedroom1-light', true, '밝기 30%'], ['bedroom1', 'bedroom1-air', true, '24°C · 자동'], ['*', 'type:light', false, '꺼짐'], ['living', 'living-tv', false, '꺼짐'], ['living', 'living-purifier', true, '수면 모드 · 저소음'],
      ] },
      { at: 19, phase: 'VERIFY', title: '취침·주방·욕실 환경 확인', detail: '주방과 욕실 2가 정상 범위에 도달해 환기와 환풍을 종료하고, 침실 외 에어컨을 끕니다.', from: 'Device Agent', to: 'Home Agent', message: '취침 환경·주방 온도·욕실 습도 정상화 확인', sensor: '전체 환경 안정', commands: [['bedroom1', 'bedroom1-air', true, '24°C · 자동'], ['*', 'name:에어컨', false, '꺼짐'], ['kitchen', 'kitchen-hood', false, '꺼짐'], ['kitchen', 'kitchen-air', false, '꺼짐'], ['bath2', 'bath2-air', false, '꺼짐']], roomUpdates: [{ roomId: 'bedroom1', temp: 24.0, humidity: 47 }, { roomId: 'bath2', temp: 24.4, humidity: 55 }] },
    ],
  },
  {
    id: 2, label: 'SIMULATION 2', title: '외출·환경 자동 관리', duration: 20, confidence: 98,
    steps: [
      { at: 0, phase: 'PREDICT', title: '현관 이동·외출 상태 예측', detail: '거실에서 현관으로 이동하는 사용자를 감지해 외출 가능성을 98%로 예측했습니다.', from: 'Presence Agent', to: 'Away Agent', message: '현관 이동 감지 · 외출 가능성 98% · 데모 예측', occupantFrom: 'living', occupant: 'exit', sensor: '현관 이동 · 외출 예측' },
      { at: 5, phase: 'ACTION', title: '외출 모드 실행', detail: '사용자 퇴실을 확인하고 조명·TV·에어컨을 끈 뒤 자동 청소를 시작합니다.', from: 'Away Agent', to: 'Device Agent', message: '퇴실 확인 · 외출 모드 전체 기기 명령', occupant: null, sensor: '재실 신호 없음', commands: [
        ['*', 'type:light', false, '꺼짐'], ['living', 'living-tv', false, '꺼짐'], ['*', 'name:에어컨', false, '꺼짐'], ['living', 'living-cleaner', true, '전체 공간 청소 중'],
      ] },
      { at: 6, phase: 'VERIFY', title: '외출 모드 확인', detail: '재실 신호가 없고 불필요한 기기는 꺼졌으며 로봇청소기가 작동 중입니다.', from: 'Device Agent', to: 'Home Agent', message: '외출 모드 적용·보안 상태 확인', sensor: '외출 · 보안 정상' },
      { at: 7, phase: 'SENSOR', title: '온도·공기질·욕실 습도 감지', detail: '외출 중 거실 온도와 미세먼지, 욕실 2의 높은 습도가 점진적으로 상승하고 있습니다.', from: 'Climate Agent', to: 'Context Agent', message: '온도·습도 상승 추세 · 공기질 악화 전달', sensor: '복합 환경 이상', roomUpdates: [{ roomId: 'living', temp: 28.2, humidity: 61 }], environmentDuration: 7000 },
      { at: 9, phase: 'PREDICT', title: '쾌적도 저하 예측', detail: 'Desktop Agent의 부재 일정과 실내 상태를 결합해 쾌적도 저하 가능성을 94%로 예측했습니다.', from: 'Desktop Agent', to: 'Home Agent', message: '외출 일정·쾌적도 저하 94% · 데모 예측', sensor: '쾌적도 분석' },
      { at: 14, phase: 'ACTION', title: '무인 환경 최적화 실행', detail: '냉방과 환기, 공기청정 및 욕실 2 습도 조절을 함께 실행합니다.', from: 'Comfort Agent', to: 'Device Agent', message: '무인 냉방·환기·공기청정·습도 제어 명령', sensor: '환경 개선 중', commands: [
        ['living', 'living-air', true, '23°C · 강풍'], ['kitchen', 'kitchen-air', true, '강제 환기 중'], ['living', 'living-purifier', true, '강풍 · 공기질 개선'], ['bath2', 'bath2-air', true, '습도 조절 중'],
      ], roomUpdates: [{ roomId: 'living', temp: 23.4, humidity: 50 }, { roomId: 'bath2', temp: 24.4, humidity: 55 }], environmentDuration: 6000, environmentCompleteCommands: [['bath2', 'bath2-air', false, '꺼짐']] },
      { at: 17, phase: 'VERIFY', title: '쾌적·욕실 환경 회복 확인', detail: '거실 온도와 습도, 욕실 2 습도가 정상 범위를 향해 계속 완만하게 내려오고 있습니다.', from: 'Device Agent', to: 'Climate Agent', message: '무인 환경·욕실 습도 회복 추세 확인', sensor: '환경 정상화 진행 중' },
    ],
  },
  {
    id: 3, label: 'SIMULATION 3', title: '조리 방치 위험 대응', duration: 27, confidence: 97,
    steps: [
      { at: 0, phase: 'SENSOR', title: '샤워 환경 감지', detail: '사용자는 욕실 1에서 샤워 중입니다. 습도가 55%에서 85%로 상승해 환풍기를 켭니다.', from: 'Mobile Agent', to: 'My Room Agent', message: '욕실 1 재실·습도 상승 전달', occupant: 'bath1', sensor: '욕실 습도 상승', commands: [['bath1', 'bath1-air', true, '강제 환풍 중']], roomUpdates: [{ roomId: 'bath1', humidity: 85 }], environmentDuration: 3000 },
      { at: 1, phase: 'SENSOR', title: '주방 이동 감지', detail: '샤워를 마친 사용자가 욕실 1에서 주방으로 이동합니다.', from: 'Mobile Agent', to: 'Home Agent', message: '욕실 1 → 주방 이동 상태 전달', occupantFrom: 'bath1', occupant: 'kitchen', sensor: '주방 이동 중' },
      { at: 5, phase: 'ACTION', title: '요리 시작', detail: '주방 도착을 확인한 후 화구·조명·후드가 켜집니다. 욕실 환풍기는 계속 작동합니다.', from: 'Home Agent', to: 'My Room Agent', message: '주방 도착 후 조리 기기 제어·욕실 환풍 지속', sensor: '조리 시작', commands: [['kitchen', 'kitchen-stove', true, '조리 중'], ['kitchen', 'kitchen-light', true, '밝기 80%'], ['kitchen', 'kitchen-hood', true, '조리 모드'], ['bath1', 'bath1-air', true, '강제 환풍 중']], roomUpdates: [{ roomId: 'kitchen', temp: 29 }, { roomId: 'bath1', humidity: 75 }], environmentDuration: 4000 },
      { at: 6, phase: 'SENSOR', title: '거실 이동 감지', detail: '사용자가 화구를 켜둔 채 주방에서 거실로 이동합니다.', from: 'Mobile Agent', to: 'Home Agent', message: '주방 → 거실 이동 상태 전달', occupantFrom: 'kitchen', occupant: 'living', sensor: '거실 이동 중' },
      { at: 12, phase: 'SENSOR', title: '움직임 중단 감지', detail: '사용자가 거실 소파에 도착한 후 약 2초간 머물렀고, 이후 움직임이 중단됐습니다.', from: 'Mobile Agent', to: 'Home Agent', message: '거실 도착·2초 체류·움직임 중단 전달', sensor: '움직임 중단' },
      { at: 13, phase: 'PREDICT', title: '수면·조리 방치 위험 예측', detail: '거실 체류와 움직임 중단을 확인했습니다. 화구는 켜진 채 주방 온도가 32°C로 상승해 방치 위험을 97%로 예측합니다.', from: 'Home Agent', to: 'Mobile Agent', message: '움직임 중단·화구 ON·온도 상승 결합 · 위험 97% · 데모 예측', sensor: '조리 방치 위험', roomUpdates: [{ roomId: 'kitchen', temp: 32 }, { roomId: 'bath1', humidity: 65 }], environmentDuration: 3000 },
      { at: 16, phase: 'ACTION', title: '긴급 경고 실행', detail: '거실 조명을 100%로 켜고 TV 화면과 Mobile Agent로 조리 방치 위험을 알립니다. 욕실 환풍은 정상 습도에 도달할 때까지 유지합니다.', from: 'Home Agent', to: 'Mobile Agent', message: '긴급 푸시 알림·TV 경고 전달·욕실 환풍 지속', sensor: '조리 위험 경고', commands: [['living', 'living-light', true, '밝기 100% · 긴급 경고'], ['living', 'living-tv', true, '조리 방치 위험 경고'], ['bath1', 'bath1-air', true, '강제 환풍 중']], roomUpdates: [{ roomId: 'bath1', humidity: 60 }], environmentDuration: 5000 },
      { at: 18, phase: 'SENSOR', title: '사용자 주방 복귀 감지', detail: '경고를 확인한 사용자가 거실에서 주방으로 이동합니다.', from: 'Mobile Agent', to: 'Home Agent', message: '거실 → 주방 응급 이동 상태 전달', occupantFrom: 'living', occupant: 'kitchen', sensor: '주방 복귀 중' },
      { at: 22, phase: 'ACTION', title: '사용자 화구 차단', detail: '주방 도착 후 화구를 수동으로 끔니다. 후드 강풍 환기로 온도가 32°C에서 28°C로 내려갑니다.', from: 'Mobile Agent', to: 'Home Agent', message: '주방 도착·화구 수동 OFF 확인', sensor: '사용자 대응 확인', commands: [['kitchen', 'kitchen-stove', false, '수동 차단'], ['kitchen', 'kitchen-hood', true, '강풍 환기 중']], roomUpdates: [{ roomId: 'kitchen', temp: 28 }], environmentDuration: 2000 },
      { at: 25, phase: 'VERIFY', title: '환경 정상화', detail: '주방 온도가 24°C로 복귀하고 후드를 끄며, 욕실 습도가 55%로 정상화되면 환풍을 자동 모드로 전환합니다.', from: 'My Room Agent', to: 'Home Agent', message: '화구 OFF·온도·욕실 습도 복귀·위험 해제 검증', sensor: '정상', commands: [['living', 'living-tv', false, '경고 해제'], ['living', 'living-light', true, '웜 화이트 · 45%'], ['kitchen', 'kitchen-hood', false, '꺼짐'], ['kitchen', 'kitchen-air', true, '자동 환기'], ['bath1', 'bath1-air', true, '자동 습도 조절']], roomUpdates: [{ roomId: 'kitchen', temp: 24 }, { roomId: 'bath1', humidity: 55 }], environmentDuration: 2000 },
    ],
  },
  {
    id: 4, label: 'SIMULATION 4', title: '환경 최적화', duration: 20, confidence: 94,
    steps: [
      { at: 0, phase: 'SENSOR', title: '온도·공기질 악화 감지', detail: '거실 온도 상승과 미세먼지 증가를 동시에 감지했습니다.', from: 'Climate Agent', to: 'Context Agent', message: '28.2°C · 공기질 나쁨 전달', occupant: 'living', sensor: '공기질 나쁨', roomUpdates: [{ roomId: 'living', temp: 28.2, humidity: 61 }] },
      { at: 5, phase: 'PREDICT', title: '쾌적도 저하 예측', detail: '현재 상태가 지속될 경우 쾌적도 저하 가능성 94%로 예측했습니다.', from: 'Context Agent', to: 'Comfort Agent', message: '쾌적도 저하 94% · 데모 예측', sensor: '쾌적도 분석' },
      { at: 11, phase: 'ACTION', title: '환경 최적화 실행', detail: '냉방 23°C, 주방 환기와 공기청정기 강풍을 실행합니다.', from: 'Comfort Agent', to: 'Device Agent', message: '냉방·환기·공기청정 명령', sensor: '공기질 개선 중', commands: [
        ['living', 'living-air', true, '23°C · 강풍'], ['kitchen', 'kitchen-air', true, '강제 환기 중'], ['living', 'living-purifier', true, '강풍 · 공기질 개선'],
      ] },
      { at: 19, phase: 'VERIFY', title: '쾌적 환경 회복 확인', detail: '온도와 습도가 안정 범위로 복귀하고 공기질이 개선되었습니다.', from: 'Device Agent', to: 'Climate Agent', message: '환경 목표값 도달 확인', sensor: '공기질 좋음', roomUpdates: [{ roomId: 'living', temp: 23.4, humidity: 50 }] },
    ],
  },
];

const cloneInitialRooms = () => initialRooms.map((room) => ({ ...room, devices: room.devices.map((device) => ({ ...device })) }));

const dailyActions = [
  { time: '07:10', title: '기상 모드 실행', detail: '침실 커튼 열기 · 조명 45%', status: '완료' },
  { time: '08:30', title: '외출 모드 전환', detail: '전체 조명 OFF · 대기전력 절감', status: '완료' },
  { time: '12:05', title: '실내 환기 실행', detail: '주방 환기 시스템 · 18분', status: '완료' },
  { time: '18:42', title: '귀가 환경 준비', detail: '거실 조명 ON · 에어컨 24°C', status: '완료' },
  { time: '20:15', title: '로봇 청소 실행', detail: '거실·다이닝 청소 완료', status: '완료' },
  { time: '22:18', title: '거실 조명 자동 소등', detail: '움직임 없음 · 15분 경과', status: '완료' },
  { time: '22:40', title: '수면 환경 준비', detail: '침실 조명 30% · 에어컨 24°C', status: '진행 중' },
  { time: '23:00', title: '수면 모드 전환', detail: '전체 조명 OFF · 방해 금지 모드', status: '예정' },
  { time: '07:10', title: '기상 모드 실행', detail: '침실 커튼 열기 · 조명 45%', status: '예정' },
];

const currentActionIndex = 6;
const getActionLabel = (index) => index < currentActionIndex ? 'PREVIOUS ACTION' : index > currentActionIndex ? 'NEXT ACTION' : 'CURRENT ACTION';

const actionWeek = [
  { key: '2026-10-12', day: 'MON', date: 12 }, { key: '2026-10-13', day: 'TUE', date: 13 },
  { key: '2026-10-14', day: 'WED', date: 14 }, { key: '2026-10-15', day: 'THU', date: 15 },
  { key: '2026-10-16', day: 'FRI', date: 16 }, { key: '2026-10-17', day: 'SAT', date: 17 },
  { key: '2026-10-18', day: 'SUN', date: 18 },
];

const actionHistory = {
  '2026-10-12': dailyActions.slice(0, 5).map((action) => ({ ...action, status: '완료' })),
  '2026-10-13': dailyActions,
  '2026-10-14': [
    { time: '07:00', title: '기상 모드 실행', detail: '침실 커튼 열기 · 조명 45%', status: '예정' },
    { time: '08:20', title: '외출 모드 전환', detail: '전체 조명 OFF · 보안 센서 ON', status: '예정' },
    { time: '18:30', title: '귀가 환경 준비', detail: '거실 조명 ON · 에어컨 24°C', status: '예정' },
  ],
  '2026-10-15': [{ time: '09:00', title: '절전 모드 실행', detail: '대기전력 최소화', status: '예정' }],
  '2026-10-16': [{ time: '18:20', title: '주말 환경 준비', detail: '거실 공기질 최적화', status: '예정' }],
  '2026-10-17': [{ time: '10:00', title: '주말 청소 실행', detail: '전체 공간 로봇 청소', status: '예정' }],
  '2026-10-18': [{ time: '21:30', title: '주간 에너지 리포트', detail: '기기별 사용량 분석', status: '예정' }],
};

function DeviceIcon({ type }) {
  if (type === 'light') return <Lightbulb size={18} />;
  if (type === 'air') return <Wind size={18} />;
  if (type === 'cleaner') return <Bot size={18} />;
  if (type === 'tv') return <Tv size={18} />;
  if (type === 'washer') return <WashingMachine size={18} />;
  if (type === 'humidifier') return <Droplets size={18} />;
  if (type === 'purifier' || type === 'hood') return <Wind size={18} />;
  if (type === 'pc') return <Monitor size={18} />;
  if (type === 'stove') return <Flame size={18} />;
  return <SlidersHorizontal size={18} />;
}

function getDeviceGroup(device) {
  if (device.type === 'light') return { key: 'lights', label: '조명', type: 'light' };
  if (device.name === '에어컨') return { key: 'air-conditioners', label: '에어컨', type: 'air' };
  if (device.type === 'cleaner') return { key: 'cleaners', label: '로봇 청소기', type: 'cleaner' };
  if (device.type === 'curtain') return { key: 'curtains', label: '스마트 커튼', type: 'curtain' };
  if (device.type === 'tv') return { key: 'televisions', label: 'TV', type: 'tv' };
  if (device.type === 'purifier') return { key: 'purifiers', label: '공기청정기', type: 'purifier' };
  if (device.type === 'humidifier') return { key: 'humidifiers', label: '가습기', type: 'humidifier' };
  if (device.type === 'washer') return { key: 'washers', label: '세탁기', type: 'washer' };
  if (device.type === 'hood') return { key: 'hoods', label: '주방 후드', type: 'hood' };
  if (device.type === 'pc') return { key: 'computers', label: '데스크톱 PC', type: 'pc' };
  if (device.type === 'stove') return { key: 'stoves', label: '화구', type: 'stove' };
  if (device.name === '환기 시스템') return { key: 'ventilation', label: '환기 시스템', type: 'air' };
  return { key: 'fans', label: '환풍기', type: 'air' };
}

function LiveProgressBar({ playing, duration, elapsed }) {
  const [visualElapsed, setVisualElapsed] = useState(elapsed);
  const visualElapsedRef = useRef(elapsed);

  useEffect(() => {
    if (!playing) {
      const pausedAt = Math.max(visualElapsedRef.current, elapsed);
      visualElapsedRef.current = pausedAt;
      setVisualElapsed(pausedAt);
      return undefined;
    }
    const startedAt = window.performance.now();
    const startedElapsed = Math.max(visualElapsedRef.current, elapsed);
    let frame = null;
    const animate = (now) => {
      const nextElapsed = Math.min(duration, startedElapsed + ((now - startedAt) / 1000));
      visualElapsedRef.current = nextElapsed;
      setVisualElapsed(nextElapsed);
      if (nextElapsed < duration) frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => { if (frame) window.cancelAnimationFrame(frame); };
  }, [playing, duration]);

  return <i className="live-progress-track" aria-label={`진행률 ${Math.round((visualElapsed / duration) * 100)}%`}><span style={{ width: `${(visualElapsed / duration) * 100}%` }} /></i>;
}

function App() {
  const sideColumnRef = useRef(null);
  const liveTimelineRef = useRef(null);
  const liveExecutedSteps = useRef(new Set());
  const roomsRef = useRef(cloneInitialRooms());
  const environmentAnimationFrame = useRef(null);
  const occupantJourneyTimer = useRef(null);
  const [rooms, setRooms] = useState(cloneInitialRooms);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [testRooms, setTestRooms] = useState(createTestRooms);
  const [selectedTestRoom, setSelectedTestRoom] = useState(null);
  const [running, setRunning] = useState(true);
  const [logs, setLogs] = useState(baseLogs);
  const [toast, setToast] = useState('');
  const [tick, setTick] = useState(0);
  const [selectedDeviceGroup, setSelectedDeviceGroup] = useState(null);
  const [selectedTargetId, setSelectedTargetId] = useState('all');
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [selectedActionDate, setSelectedActionDate] = useState('2026-10-13');
  const [decisionActionIndex, setDecisionActionIndex] = useState(currentActionIndex);
  const [decisionMotion, setDecisionMotion] = useState({ direction: 'idle', id: 0 });
  const [activeTab, setActiveTab] = useState('home');
  const [liveScenarioId, setLiveScenarioId] = useState(1);
  const [livePlaying, setLivePlaying] = useState(false);
  const [liveElapsed, setLiveElapsed] = useState(0);
  const [liveRunId, setLiveRunId] = useState(0);
  const [liveActivity, setLiveActivity] = useState([]);
  const [liveMessages, setLiveMessages] = useState([]);
  const [livePhase, setLivePhase] = useState('READY');
  const [liveSensor, setLiveSensor] = useState('대기 중');
  const [occupantRoom, setOccupantRoom] = useState(null);

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  useEffect(() => () => {
    if (environmentAnimationFrame.current) window.cancelAnimationFrame(environmentAnimationFrame.current);
    if (occupantJourneyTimer.current) window.clearTimeout(occupantJourneyTimer.current);
  }, []);

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => setTick((value) => value + 1), 3200);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (sideColumnRef.current) sideColumnRef.current.scrollTop = 0;
  }, [selectedRoom]);

  useEffect(() => {
    if (liveActivity.length <= 3 || !liveTimelineRef.current) return;
    const timeline = liveTimelineRef.current;
    window.requestAnimationFrame(() => timeline.scrollTo({ top: timeline.scrollHeight, behavior: 'smooth' }));
  }, [liveActivity.length]);

  useEffect(() => {
    if (!running || tick === 0) return;
    const events = [
      ['Mobile Agent', 'Home Agent', '거실 위치·이동 상태 전달', 'blue'],
      ['Home Agent', 'My Room Agent', '환경 최적화 작업 요청', 'green'],
      ['Desktop Agent', 'Home Agent', 'PC 활동·일정 맥락 동기화', 'purple'],
    ];
    const event = events[tick % events.length];
    const now = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    setLogs((current) => [{ time: now, from: event[0], to: event[1], text: event[2], color: event[3] }, ...current].slice(0, 5));
  }, [tick, running]);

  const deviceItems = useMemo(
    () => rooms.flatMap((item) => item.devices
      .map((device) => ({ ...device, roomId: item.id, roomName: item.name, connected: device.connected !== false }))),
    [rooms],
  );
  const connectedDevices = deviceItems.filter((device) => device.connected).length;
  const deviceGroups = useMemo(() => {
    const groups = new Map();
    deviceItems.forEach((device) => {
      const meta = getDeviceGroup(device);
      if (!groups.has(meta.key)) groups.set(meta.key, { ...meta, devices: [] });
      groups.get(meta.key).devices.push(device);
    });
    return Array.from(groups.values());
  }, [deviceItems]);
  const selectedGroup = deviceGroups.find((group) => group.key === selectedDeviceGroup) || null;
  const selectedTargets = selectedGroup
    ? (selectedTargetId === 'all' ? selectedGroup.devices : selectedGroup.devices.filter((device) => device.id === selectedTargetId))
    : [];
  const targetConnectedCount = selectedTargets.filter((device) => device.connected).length;
  const targetOnCount = selectedTargets.filter((device) => device.connected && device.on).length;

  const room = selectedRoom ? rooms.find((item) => item.id === selectedRoom) : null;
  const selectedDay = actionWeek.find((day) => day.key === selectedActionDate);
  const selectedDayActions = actionHistory[selectedActionDate] || [];
  const completedActionCount = selectedDayActions.filter((action) => action.status === '완료').length;
  const upcomingActionCount = selectedDayActions.filter((action) => action.status === '예정').length;
  const decisionPreviousIndex = Math.max(0, decisionActionIndex - 1);
  const decisionNextIndex = Math.min(dailyActions.length - 1, decisionActionIndex + 1);
  const decisionCurrent = dailyActions[decisionActionIndex];
  const decisionPrevious = dailyActions[decisionPreviousIndex];
  const decisionNext = dailyActions[decisionNextIndex];
  const decisionPrediction = decisionCurrent.title === '수면 환경 준비'
    ? '사용자가 곧 취침할 것으로 예상하고 있어요.'
    : `${decisionCurrent.title}에 필요한 상태를 Agent가 감지했어요.`;
  const environment = room
    ? { label: room.name, temp: room.temp, humidity: room.humidity, sensor: '정상' }
    : {
        label: '평균',
        temp: rooms.reduce((sum, item) => sum + item.temp, 0) / rooms.length,
        humidity: Math.round(rooms.reduce((sum, item) => sum + item.humidity, 0) / rooms.length),
        sensor: '정상',
      };
  const testRoom = selectedTestRoom ? testRooms.find((item) => item.id === selectedTestRoom) : null;
  const testEnvironment = testRoom
    ? { label: testRoom.name, temp: testRoom.temp, humidity: testRoom.humidity, sensor: '테스트' }
    : {
        label: '평균',
        temp: testRooms.reduce((sum, item) => sum + item.temp, 0) / testRooms.length,
        humidity: Math.round(testRooms.reduce((sum, item) => sum + item.humidity, 0) / testRooms.length),
        sensor: '테스트',
      };
  const liveScenario = simulationScenarios.find((scenario) => scenario.id === liveScenarioId) || simulationScenarios[0];
  const occupantRoomName = rooms.find((item) => item.id === occupantRoom)?.name;
  const liveHasExited = liveActivity.some((event) => Object.prototype.hasOwnProperty.call(event, 'occupant') && event.occupant === null);
  const liveEnvironment = {
    ...environment,
    sensor: '정상',
    presence: liveHasExited ? '외출' : occupantRoom === 'exit' ? '현관' : occupantRoomName || '거실',
  };
  environment.presence = '거실';
  testEnvironment.presence = '거실';

  const setDevicePower = (roomId, deviceId, nextValue) => {
    const targetRoom = rooms.find((item) => item.id === roomId);
    const targetDevice = targetRoom?.devices.find((device) => device.id === deviceId);
    if (!targetDevice || targetDevice.connected === false) return;
    const label = targetDevice.name;
    setRooms((current) => current.map((item) => {
      if (item.id !== roomId) return item;
      return {
        ...item,
        devices: item.devices.map((device) => {
          if (device.id !== deviceId) return device;
          return { ...device, on: nextValue, value: nextValue ? (device.type === 'light' ? '켜짐 · 50%' : '작동 중') : '꺼짐' };
        }),
      };
    }));
    setToast(`${label}이(가) ${nextValue ? '켜졌습니다' : '꺼졌습니다'}`);
    window.setTimeout(() => setToast(''), 2200);
  };

  const toggleDevice = (roomId, deviceId) => {
    const target = rooms.find((item) => item.id === roomId)?.devices.find((device) => device.id === deviceId);
    if (target) setDevicePower(roomId, deviceId, !target.on);
  };

  const toggleConnection = (roomId, deviceId) => {
    const target = rooms.find((item) => item.id === roomId)?.devices.find((device) => device.id === deviceId);
    if (!target) return;
    const reconnect = target.connected === false;
    setRooms((current) => current.map((item) => item.id !== roomId ? item : {
      ...item,
      devices: item.devices.map((device) => device.id !== deviceId ? device : { ...device, connected: reconnect, on: reconnect ? device.on : false }),
    }));
    setToast(`${target.name} 연결을 ${reconnect ? '복구했습니다' : '해제했습니다'}`);
    window.setTimeout(() => setToast(''), 2200);
  };

  const setGroupPower = (nextValue) => {
    const targetIds = new Set(selectedTargets.filter((device) => device.connected).map((device) => device.id));
    if (!targetIds.size) return;
    setRooms((current) => current.map((item) => ({
      ...item,
      devices: item.devices.map((device) => targetIds.has(device.id)
        ? { ...device, on: nextValue, value: nextValue ? (device.type === 'light' ? '켜짐 · 50%' : '작동 중') : '꺼짐' }
        : device),
    })));
    setToast(`${selectedTargetId === 'all' ? `전체 ${selectedGroup.label}` : selectedTargets[0].roomName}을(를) ${nextValue ? '켰습니다' : '껐습니다'}`);
    window.setTimeout(() => setToast(''), 2200);
  };

  const toggleGroupConnection = () => {
    const reconnect = targetConnectedCount === 0;
    const targetIds = new Set(selectedTargets.map((device) => device.id));
    setRooms((current) => current.map((item) => ({
      ...item,
      devices: item.devices.map((device) => targetIds.has(device.id)
        ? { ...device, connected: reconnect, on: reconnect ? device.on : false }
        : device),
    })));
    setToast(`${selectedTargetId === 'all' ? `전체 ${selectedGroup.label}` : selectedTargets[0].roomName} 연결을 ${reconnect ? '복구했습니다' : '해제했습니다'}`);
    window.setTimeout(() => setToast(''), 2200);
  };

  const toggleSimulation = () => {
    setRunning((value) => !value);
    setToast(running ? '시뮬레이션을 일시 정지했습니다' : '시뮬레이션을 다시 시작했습니다');
    window.setTimeout(() => setToast(''), 2200);
  };

  const moveDecision = (direction) => {
    const delta = direction === 'next' ? 1 : -1;
    setDecisionActionIndex((index) => Math.min(dailyActions.length - 1, Math.max(0, index + delta)));
    setDecisionMotion((motion) => ({ direction, id: motion.id + 1 }));
  };

  const updateTestEnvironment = (field, value) => {
    if (!selectedTestRoom) return;
    setTestRooms((current) => current.map((item) => item.id === selectedTestRoom ? { ...item, [field]: Number(value) } : item));
  };

  const resetTestEnvironment = () => setTestRooms(createTestRooms());

  const applyLiveCommands = (commands) => {
    if (!commands.length) return;
    setRooms((current) => current.map((item) => ({
      ...item,
      devices: item.devices.map((device) => {
        const command = commands.find(([roomId, target]) => {
          if (roomId !== '*' && roomId !== item.id) return false;
          if (target.startsWith('type:')) return device.type === target.slice(5);
          if (target.startsWith('name:')) return device.name === target.slice(5);
          return device.id === target;
        });
        return command ? { ...device, on: command[2], value: command[3] } : device;
      }),
    })));
  };

  const animateRoomEnvironment = (updates, duration = 4200, completeCommands = []) => {
    if (!updates.length) return;
    if (environmentAnimationFrame.current) window.cancelAnimationFrame(environmentAnimationFrame.current);
    const targets = new Map(updates.map((update) => [update.roomId, update]));
    const starts = new Map(updates.map((update) => {
      const currentRoom = roomsRef.current.find((item) => item.id === update.roomId);
      return [update.roomId, { temp: currentRoom?.temp, humidity: currentRoom?.humidity }];
    }));
    const startedAt = window.performance.now();

    const animate = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = progress * progress * (3 - (2 * progress));
      setRooms((current) => current.map((item) => {
        const target = targets.get(item.id);
        const start = starts.get(item.id);
        if (!target || !start) return item;
        return {
          ...item,
          ...(target.temp == null ? {} : { temp: start.temp + ((target.temp - start.temp) * eased) }),
          ...(target.humidity == null ? {} : { humidity: start.humidity + ((target.humidity - start.humidity) * eased) }),
        };
      }));
      if (progress < 1) environmentAnimationFrame.current = window.requestAnimationFrame(animate);
      else {
        environmentAnimationFrame.current = null;
        applyLiveCommands(completeCommands);
      }
    };

    environmentAnimationFrame.current = window.requestAnimationFrame(animate);
  };

  const applyLiveStep = (step) => {
    const roomUpdates = step.roomUpdates || [];
    const commands = step.commands || [];
    if (roomUpdates.length) animateRoomEnvironment(roomUpdates, step.environmentDuration || 4200, step.environmentCompleteCommands || []);
    applyLiveCommands(commands);
    if (step.occupantFrom && Object.prototype.hasOwnProperty.call(step, 'occupant')) {
      if (occupantJourneyTimer.current) window.clearTimeout(occupantJourneyTimer.current);
      setOccupantRoom(step.occupantFrom);
      occupantJourneyTimer.current = window.setTimeout(() => {
        setOccupantRoom(step.occupant);
        occupantJourneyTimer.current = null;
      }, 120);
    } else if (Object.prototype.hasOwnProperty.call(step, 'occupant')) setOccupantRoom(step.occupant);
    if (step.sensor) setLiveSensor(step.sensor);
    setLivePhase(step.phase);
    const eventTime = `00:${String(step.at).padStart(2, '0')}`;
    setLiveActivity((current) => [...current, { ...step, time: eventTime }]);
    setLiveMessages((current) => [...current, { time: eventTime, from: agentRole(step.from), to: agentRole(step.to), text: step.message, phase: step.phase }]);
  };

  const restartLiveScenario = (scenarioId = liveScenarioId) => {
    if (environmentAnimationFrame.current) window.cancelAnimationFrame(environmentAnimationFrame.current);
    environmentAnimationFrame.current = null;
    if (occupantJourneyTimer.current) window.clearTimeout(occupantJourneyTimer.current);
    occupantJourneyTimer.current = null;
    const resetRooms = cloneInitialRooms();
    roomsRef.current = resetRooms;
    setRooms(resetRooms);
    setSelectedRoom(null);
    setLiveScenarioId(scenarioId);
    setLiveElapsed(0);
    setLiveActivity([]);
    setLiveMessages([]);
    setLivePhase('READY');
    setLiveSensor('대기 중');
    setOccupantRoom(null);
    liveExecutedSteps.current = new Set();
    setLiveRunId((value) => value + 1);
    setLivePlaying(true);
  };

  const handleScenarioButton = (scenarioId) => {
    if (scenarioId !== liveScenarioId || liveRunId === 0 || liveElapsed >= liveScenario.duration) {
      restartLiveScenario(scenarioId);
      return;
    }
    setLivePlaying((value) => !value);
  };

  useEffect(() => {
    if (!livePlaying || activeTab !== 'live') return undefined;
    const timer = window.setInterval(() => {
      setLiveElapsed((current) => Math.min(liveScenario.duration, current + 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [livePlaying, activeTab, liveScenario.duration, liveRunId]);

  useEffect(() => {
    if (!liveRunId) return;
    liveScenario.steps.forEach((step, index) => {
      if (step.at <= liveElapsed && !liveExecutedSteps.current.has(index)) {
        liveExecutedSteps.current.add(index);
        applyLiveStep(step);
      }
    });
    if (liveElapsed >= liveScenario.duration) {
      setLivePlaying(false);
      setLiveSensor('시나리오 완료');
    }
  }, [liveElapsed, liveRunId, liveScenario]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">SWE_simulator</div>
        <nav className="main-tabs" aria-label="주요 화면">
          {[
            ['home', 'Home'],
            ['model', '3D Model'],
            ['live', 'Live Simulation'],
            ['test', 'Control Mode'],
            ['activity', 'Agent Activity'],
          ].map(([key, label]) => (
            <button className={activeTab === key ? 'active' : ''} key={key} onClick={() => setActiveTab(key)}>{label}</button>
          ))}
        </nav>
      </header>

      <main className={`dashboard tab-${activeTab}`}>
        {activeTab === 'home' && (
        <div className="main-grid">
          <section className="floor-card">
            <div className="panel-heading">
              <div className="panel-heading-title">
                <div className="heading-label"><h2>Home Simulation</h2></div>
              </div>
              <div className="panel-heading-actions">
                <p>공간을 선택하면 방 안으로 들어가 기기와 환경 상태를 제어할 수 있어요.</p>
                <div className="simulation-control">
                  <button onClick={toggleSimulation} className={running ? 'pause' : ''}>
                    {running ? <CircleDot size={17} /> : <Play size={17} />}
                    LIVE SIMULATION
                  </button>
                </div>
              </div>
            </div>

            <Home3D rooms={rooms} environment={environment} selectedRoom={selectedRoom} onRoomSelect={setSelectedRoom} onBack={() => setSelectedRoom(null)} />

          </section>

          <aside className="side-column" ref={sideColumnRef}>
            {room ? (
              <section className="room-side-dashboard panel" aria-label={`${room.name} 상세 대시보드`}>
                <div className="room-side-hero">
                  <div>
                    <p>ROOM · {room.en.toUpperCase()}</p>
                    <h2>{room.name}</h2>
                    <span>{room.description}</span>
                  </div>
                  <div className="room-side-icon"><room.icon size={28} /></div>
                </div>
                <div className="room-side-title"><h3>연결된 기기</h3><span>{room.devices.length} DEVICES</span></div>
                <div className="room-side-devices">
                  {room.devices.map((device) => (
                    <button className={`device-card ${device.on ? 'active' : ''}`} key={device.id} onClick={() => toggleDevice(room.id, device.id)}>
                      <span className="device-icon"><DeviceIcon type={device.type} /></span>
                      <span className="device-info"><b>{device.name}</b><small>{device.value}</small></span>
                      <span className="power-button"><Power size={16} /></span>
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <>
                <section className="decision-card dark-card" role="button" tabIndex={0} aria-haspopup="dialog" onClick={() => setDecisionOpen(true)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setDecisionOpen(true); }}>
                  <div className="card-title-row">
                    <div className="mint-icon"><BrainCircuit size={22} /></div>
                    <div><h2>Agent Decision</h2></div>
                    <span className="confidence">TODAY · {dailyActions.length} ACTIONS</span>
                  </div>
                  <div className={`decision-orbit motion-${decisionMotion.direction}`} key={decisionMotion.id}>
                    <svg className="orbit-line" viewBox="0 0 80 270" preserveAspectRatio="none" aria-hidden="true">
                      <path d="M 31 30 Q 76 135 31 244" />
                    </svg>
                    <button className="orbit-action orbit-previous" type="button" disabled={decisionActionIndex === 0} onClick={(event) => { event.stopPropagation(); moveDecision('previous'); }}>
                      <i /><div><em>{getActionLabel(decisionPreviousIndex)} · {decisionPrevious.time}</em><b>{decisionPrevious.title}</b></div>
                    </button>
                    <div className="orbit-action orbit-current" key={decisionCurrent.time}>
                      <i /><div><em>{getActionLabel(decisionActionIndex)} · {decisionCurrent.status}</em><b>{decisionCurrent.title}</b><small>{decisionCurrent.time} · {decisionCurrent.detail}</small><p><strong>PREDICTION · 96%</strong> {decisionPrediction}</p></div>
                    </div>
                    <button className="orbit-action orbit-next" type="button" disabled={decisionActionIndex === dailyActions.length - 1} onClick={(event) => { event.stopPropagation(); moveDecision('next'); }}>
                      <i /><div><em>{getActionLabel(decisionNextIndex)} · {decisionNext.time}</em><b>{decisionNext.title}</b></div>
                    </button>
                  </div>
                  <div className="decision-footer"><span>최근 업데이트 · 22:32</span><span>오늘 기록 보기 <ChevronRight size={13} /></span></div>
                </section>
                <section className="active-manager panel" aria-label="기기 연결 상태">
                  <div className="active-manager-heading">
                    <div><span className="active-manager-icon"><Wifi size={15} /></span><h2>기기 연결 상태</h2></div>
                    <strong>{connectedDevices}/{deviceItems.length} CONNECTED</strong>
                  </div>
                  <div className="active-device-list">
                    {deviceGroups.map((group) => {
                      const connected = group.devices.filter((device) => device.connected).length;
                      const powered = group.devices.filter((device) => device.connected && device.on).length;
                      return <button className={`${selectedDeviceGroup === group.key ? 'selected' : ''} ${connected ? '' : 'disconnected'}`} key={group.key} onClick={() => { setSelectedDeviceGroup(group.key); setSelectedTargetId('all'); }} aria-haspopup="dialog">
                        <span className="device-icon"><DeviceIcon type={group.type} /></span>
                        <span><small>{connected}/{group.devices.length} 연결됨</small><b>{group.label}</b></span>
                        <em>{connected ? `${powered} ON` : 'OFFLINE'}</em>
                      </button>
                    })}
                  </div>
                </section>
              </>
            )}

            <section className="activity-card panel">
              <div className="panel-heading compact">
                <div><h2>Agent Activity</h2></div>
                <button className="text-button">전체 보기 <ChevronRight size={14} /></button>
              </div>
              <div className="timeline">
                <div className="timeline-item"><span className="time">22:31</span><i className="timeline-dot" /><p><b>위치 상태 수신</b><small>Mobile Agent · 침실 재실</small></p><span className="event-tag">CONTEXT</span></div>
                <div className="timeline-item"><span className="time">22:32</span><i className="timeline-dot purple" /><p><b>활동 맥락 결합</b><small>Desktop Agent · PC 활동 종료</small></p><span className="event-tag purple">CONTEXT</span></div>
                <div className="timeline-item"><span className="time">22:32</span><i className="timeline-dot green" /><p><b>개인 방 환경 실행</b><small>My Room Agent · 조명·냉방 제어</small></p><span className="event-tag green">ACTION</span></div>
              </div>
            </section>

            <section className="a2a-card panel">
              <div className="panel-heading compact">
                <div><h2>A2A Communication</h2></div>
                <div className="socket-state"><Wifi size={13} /> 실시간 연결됨</div>
              </div>
              <div className="agent-network">
                {['Home', 'My Room', 'Desktop', 'Mobile'].map((agent, index) => <div key={agent} className={`agent-node node-${index}`}><Bot size={17} /><span>{agent}</span></div>)}
                <svg className="agent-connection-map" viewBox="0 0 300 64" preserveAspectRatio="none" aria-hidden="true"><path d="M47 32 C90 4 110 4 150 32 S215 60 256 32" /><circle cx="111" cy="15" r="3" /><circle cx="218" cy="49" r="3" /></svg>
              </div>
              <div className="log-list">
                {logs.slice(0, 3).map((log, index) => (
                  <div className="log-row" key={`${log.time}-${index}`}>
                    <span className="log-time">{log.time}</span>
                    <span className={`agent-pill ${log.color}`}>{log.from.replace(' Agent', '')}</span>
                    <ChevronRight size={12} />
                    <span className="log-text">{log.text}</span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
        )}

        {activeTab === 'model' && (
          <section className="model-tab" aria-label="3D 스마트홈 모델">
            <Home3D rooms={rooms} environment={environment} selectedRoom={selectedRoom} onRoomSelect={setSelectedRoom} onBack={() => setSelectedRoom(null)} />
          </section>
        )}

        {activeTab === 'live' && (
          <div className="main-grid live-simulation-tab">
            <section className="floor-card">
              <div className="panel-heading">
                <div className="panel-heading-title">
                  <div className="heading-label"><h2>Live Simulation</h2></div>
                </div>
                <div className="panel-heading-actions">
                  <div className="live-mode-controls" aria-label="라이브 시뮬레이션 모드">
                    {simulationScenarios.map((scenario) => (
                      <button
                        type="button"
                        className={liveScenarioId === scenario.id ? 'active' : ''}
                        aria-pressed={liveScenarioId === scenario.id}
                        aria-label={`${scenario.label} ${scenario.title} ${liveScenarioId === scenario.id && livePlaying ? '일시정지' : '재생'}`}
                        key={scenario.id}
                        onClick={() => handleScenarioButton(scenario.id)}
                      >
                        {liveScenarioId === scenario.id && livePlaying ? <Pause size={15} /> : <Play size={15} />}
                        {scenario.label}
                      </button>
                    ))}
                    <button type="button" className="live-restart" onClick={() => restartLiveScenario()} aria-label="현재 시뮬레이션 재시작"><RotateCcw size={15} /></button>
                  </div>
                </div>
              </div>
              <Home3D rooms={rooms} environment={liveEnvironment} selectedRoom={selectedRoom} onRoomSelect={setSelectedRoom} onBack={() => setSelectedRoom(null)} occupantRoom={occupantRoom} />
            </section>

            <aside className="side-column" aria-label="실시간 에이전트 모니터링">
              <section className="activity-card panel">
                <div className="panel-heading compact">
                  <div><h2>Agent Activity</h2></div>
                  <span className={`live-phase phase-${livePhase.toLowerCase()}`}>{livePhase}</span>
                </div>
                <div className="live-run-summary">
                  <div><b>{liveScenario.title}</b><span>{String(liveElapsed).padStart(2, '0')} / {liveScenario.duration}s</span></div>
                  <LiveProgressBar key={`${liveRunId}-${liveScenarioId}`} playing={livePlaying && activeTab === 'live'} duration={liveScenario.duration} elapsed={liveElapsed} />
                  <small>예측 신뢰도 {liveScenario.confidence}% · 데모용 Mock Data</small>
                </div>
                <div className="timeline live-timeline" ref={liveTimelineRef}>
                  {liveActivity.length ? liveActivity.map((event, index) => (
                    <div className="timeline-item" key={`${event.phase}-${event.time}-${index}`}>
                      <span className="time">{event.time}</span><i className={`timeline-dot ${event.phase.toLowerCase()}`} />
                      <p><b>{event.title}</b><small>{event.detail}</small></p><span className={`event-tag ${event.phase.toLowerCase()}`}>{event.phase}</span>
                    </div>
                  )) : <div className="live-empty-state"><Play size={16} /><span>Simulation 버튼을 눌러 시나리오를 시작하세요.</span></div>}
                </div>
              </section>

              <section className="a2a-card panel">
                <div className="panel-heading compact">
                  <div><h2>A2A Communication</h2></div>
                  <div className="socket-state"><Wifi size={13} /> 실시간 연결됨</div>
                </div>
                <div className="agent-network">
                  {['Home', 'My Room', 'Desktop', 'Mobile'].map((agent, index) => <div key={agent} className={`agent-node node-${index} ${liveRunId ? 'active' : ''}`}><Bot size={17} /><span>{agent}</span></div>)}
                  <svg className="agent-connection-map" viewBox="0 0 300 64" preserveAspectRatio="none" aria-hidden="true"><path d="M47 32 C90 4 110 4 150 32 S215 60 256 32" /><circle cx="111" cy="15" r="3" /><circle cx="218" cy="49" r="3" /></svg>
                </div>
                <div className="log-list">
                  {liveMessages.length ? liveMessages.map((log, index) => (
                    <div className="log-row" key={`${log.phase}-${log.time}-${index}`}>
                      <span className="log-time">{log.time}</span>
                      <span className={`agent-pill ${log.phase.toLowerCase()}`}>{log.from.replace(' Agent', '')}</span>
                      <ChevronRight size={12} />
                      <span className="log-text"><b>{log.to.replace(' Agent', '')}</b> · {log.text}</span>
                    </div>
                  )) : <div className="live-empty-state compact"><Wifi size={14} /><span>Agent 메시지를 기다리는 중입니다.</span></div>}
                </div>
              </section>
            </aside>
          </div>
        )}

        {activeTab === 'test' && (
          <div className="test-tab">
            <section className="test-model" aria-label="환경 테스트용 3D 스마트홈">
              <Home3D rooms={testRooms} environment={testEnvironment} selectedRoom={selectedTestRoom} onRoomSelect={setSelectedTestRoom} onBack={() => setSelectedTestRoom(null)} />
            </section>
            <aside className="test-control panel">
              <div className="test-control-heading">
                <div><span>ENVIRONMENT LAB</span><h2>Room Test Control</h2><p>테스트용 값은 Home 환경과 별도로 관리됩니다.</p></div>
                <button type="button" onClick={resetTestEnvironment} aria-label="테스트 환경 초기화"><RotateCcw size={14} /></button>
              </div>
              <div className="test-room-list" aria-label="테스트할 방 선택">
                {testRooms.map((item) => <button type="button" className={selectedTestRoom === item.id ? 'active' : ''} key={item.id} onClick={() => setSelectedTestRoom(item.id)}>{item.name}</button>)}
              </div>
              {testRoom ? (
                <div className="test-sliders">
                  <div className="test-selected-room"><span>SELECTED ROOM</span><h3>{testRoom.name}</h3><p>{testRoom.description}</p></div>
                  <label className={`test-slider temperature ${testRoom.temp > testLimits.temp ? 'is-alert' : ''}`}>
                    <span><i><Thermometer size={16} /></i><b>온도</b><output>{testRoom.temp.toFixed(1)}°C</output></span>
                    <input type="range" min="16" max="32" step="0.1" value={testRoom.temp} onChange={(event) => updateTestEnvironment('temp', event.target.value)} />
                    <small><em>16°C</em><em>32°C</em></small>
                  </label>
                  <label className={`test-slider humidity ${testRoom.humidity > testLimits.humidity ? 'is-alert' : ''}`}>
                    <span><i><Droplets size={16} /></i><b>습도</b><output>{testRoom.humidity}%</output></span>
                    <input type="range" min="20" max="80" step="1" value={testRoom.humidity} onChange={(event) => updateTestEnvironment('humidity', event.target.value)} />
                    <small><em>20%</em><em>80%</em></small>
                  </label>
                  <label className={`test-slider noise ${testRoom.noise > testLimits.noise ? 'is-alert' : ''}`}>
                    <span><i><Volume2 size={16} /></i><b>소음</b><output>{testRoom.noise} dB</output></span>
                    <input type="range" min="20" max="90" step="1" value={testRoom.noise} onChange={(event) => updateTestEnvironment('noise', event.target.value)} />
                    <small><em>20 dB</em><em>90 dB</em></small>
                  </label>
                  <div className="test-state-note"><i />이 설정은 Control Mode에서만 적용됩니다.</div>
                </div>
              ) : (
                <div className="test-empty"><SlidersHorizontal size={24} /><h3>방을 선택해 주세요</h3><p>3D 모델이나 위의 방 목록을 선택하면 환경 값을 조정할 수 있습니다.</p></div>
              )}
            </aside>
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="activity-tab">
            <section className="activity-detail panel">
              <div className="activity-page-heading">
                <div><span>LIVE EVENT STREAM</span><h1>Agent Activity</h1></div>
                <div className="live-state"><i /> LIVE</div>
              </div>
              <div className="activity-stats">
                <div><span>오늘의 이벤트</span><b>24</b><small>+6 since 18:00</small></div>
                <div><span>자동 실행</span><b>9</b><small>성공률 100%</small></div>
                <div><span>평균 응답</span><b>0.8s</b><small>실시간 연결</small></div>
              </div>
              <div className="expanded-timeline">
                {[
                  ['22:32:10', 'ACTION', '개인 방 환경 적용', '침실 조명 30% · 에어컨 24°C 설정 완료', 'My Room Agent'],
                  ['22:32:09', 'COORDINATE', '수면 환경 작업 조정', '활동·위치 맥락을 결합해 취침 준비 요청', 'Home Agent'],
                  ['22:32:08', 'CONTEXT', 'PC 활동·일정 전달', 'PC 활동 종료와 다음 일정 없음 확인', 'Desktop Agent'],
                  ['22:31:42', 'LOCATION', '침실 이동 상태 전달', '사용자 위치와 이동 종료 상태 확인', 'Mobile Agent'],
                  ['22:18:04', 'ACTION', '거실 환경 자동 정리', '재실 상태와 연결해 조명 자동 소등', 'My Room Agent'],
                  ['20:15:21', 'COORDINATE', '청소 작업 완료 확인', '전체 상태에 로봇 청소 결과 반영', 'Home Agent'],
                ].map((event, index) => (
                  <div className="expanded-event" key={event[0]}>
                    <time>{event[0]}</time><i className={index < 2 ? 'active' : ''} />
                    <div><span>{event[1]}</span><h3>{event[2]}</h3><p>{event[3]}</p></div><em>{event[4]}</em>
                  </div>
                ))}
              </div>
            </section>

            <section className="a2a-detail panel">
              <div className="activity-page-heading compact-heading">
                <div><span>AGENT TO AGENT</span><h2>A2A Communication</h2></div>
                <div className="socket-state"><Wifi size={13} /> 실시간 연결됨</div>
              </div>
              <div className="expanded-network">
                {['Home Agent', 'My Room Agent', 'Desktop Agent', 'Mobile Agent'].map((agent, index) => <React.Fragment key={agent}><div className="expanded-agent"><Bot size={20} /><b>{agent}</b><span>ONLINE</span></div>{index < 3 && <ChevronRight size={16} />}</React.Fragment>)}
              </div>
              <div className="a2a-log-heading"><span>TIME</span><span>MESSAGE ROUTE</span><span>PAYLOAD</span><span>STATUS</span></div>
              <div className="expanded-log-list">
                {logs.map((log, index) => (
                  <div className="expanded-log" key={`${log.time}-${index}`}>
                    <time>{log.time}</time><div><b>{log.from}</b><ChevronRight size={12} /><b>{log.to}</b></div><p>{log.text}</p><em>DELIVERED</em>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>

      {selectedGroup && (
        <div className="device-control-overlay" role="presentation">
          <button className="device-control-backdrop" onClick={() => setSelectedDeviceGroup(null)} aria-label="기기 상세 닫기" />
          <section className="device-control-modal" role="dialog" aria-modal="true" aria-labelledby="device-control-title">
            <button className="device-control-close" onClick={() => setSelectedDeviceGroup(null)} aria-label="닫기"><X size={17} /></button>
            <span className="device-control-icon"><DeviceIcon type={selectedGroup.type} /></span>
            <p>SMART HOME · DEVICE CONTROL</p>
            <h2 id="device-control-title">{selectedGroup.label}</h2>
            <label className="device-target-select">제어할 위치
              <select value={selectedTargetId} onChange={(event) => setSelectedTargetId(event.target.value)}>
                <option value="all">전체 {selectedGroup.label}</option>
                {selectedGroup.devices.map((device) => <option value={device.id} key={device.id}>{device.roomName} · {device.name}</option>)}
              </select>
            </label>
            <div className={`connection-state ${targetConnectedCount ? '' : 'offline'}`}><i />{targetConnectedCount}/{selectedTargets.length} 연결됨<em>{targetConnectedCount ? `${targetOnCount}/${targetConnectedCount} ON` : 'OFFLINE'}</em></div>
            <div className="device-control-actions">
              {targetConnectedCount > 0 && <button className={targetOnCount === targetConnectedCount ? 'selected' : ''} onClick={() => setGroupPower(true)}><Power size={14} /> 켜기</button>}
              {targetConnectedCount > 0 && <button className={targetOnCount === 0 ? 'selected' : ''} onClick={() => setGroupPower(false)}><Power size={14} /> 끄기</button>}
              <button className="disconnect" onClick={toggleGroupConnection}>{targetConnectedCount ? '연결 끊기' : '다시 연결'}</button>
            </div>
          </section>
        </div>
      )}

      {decisionOpen && (
        <div className="action-history-overlay" role="presentation">
          <button className="action-history-backdrop" onClick={() => setDecisionOpen(false)} aria-label="액션 기록 닫기" />
          <section className="action-history-modal" role="dialog" aria-modal="true" aria-labelledby="action-history-title">
            <header>
              <div><span>AGENT DECISION · OCTOBER 2026</span><h2 id="action-history-title">{selectedActionDate === '2026-10-13' ? 'Today' : `10월 ${selectedDay?.date}일`}</h2></div>
              <button onClick={() => setDecisionOpen(false)} aria-label="닫기"><X size={17} /></button>
            </header>
            <div className="action-date-strip" aria-label="날짜 선택">
              {actionWeek.map((day) => <button className={`${selectedActionDate === day.key ? 'selected' : ''} ${day.key === '2026-10-13' ? 'today' : ''}`} key={day.key} onClick={() => setSelectedActionDate(day.key)}><span>{day.day}</span><b>{day.date}</b><i /></button>)}
            </div>
            <div className="action-history-summary"><b>{completedActionCount}</b><span>완료된 액션</span><i /><b>{upcomingActionCount}</b><span>예정된 액션</span></div>
            <div className="action-history-list">
              {selectedDayActions.map((action) => (
                <div className={`action-history-row ${action.status === '예정' ? 'upcoming' : ''}`} key={`${action.time}-${action.title}`}>
                  <time>{action.time}</time><i /><div><b>{action.title}</b><small>{action.detail}</small></div><em>{action.status}</em>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast"><ShieldCheck size={17} />{toast}</div>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
