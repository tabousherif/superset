/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { ChartProps, SqlaFormData } from '@superset-ui/core';
import { supersetTheme } from '@apache-superset/core/theme';
import { DensityCurve, EchartsBoxPlotChartProps } from '../../src/BoxPlot/types';
import transformProps from '../../src/BoxPlot/transformProps';

interface QueryData {
  type: string;
  region: string;
  'AVG(averageprice)__mean': number;
  'AVG(averageprice)__median': number;
  'AVG(averageprice)__max': number;
  'AVG(averageprice)__min': number;
  'AVG(averageprice)__q1': number;
  'AVG(averageprice)__q3': number;
  'AVG(averageprice)__count': number;
  'AVG(averageprice)__outliers': number[];
  'AVG(averageprice)__density': DensityCurve;
}

interface QuerySeriesData {
  data: QueryData[];
}

describe('BoxPlot transformProps', () => {
  const formData: SqlaFormData = {
    datasource: '5__table',
    granularity_sqla: 'ds',
    time_grain_sqla: 'P1Y',
    columns: [],
    metrics: ['AVG(averageprice)'],
    groupby: ['type', 'region'],
    whiskerOptions: 'Tukey',
    yAxisFormat: 'SMART_NUMBER',
    viz_type: 'my_chart',
    zoomable: true,
  };
  const chartProps = new ChartProps({
    formData,
    width: 800,
    height: 600,
    queriesData: [
      {
        data: [
          {
            type: 'organic',
            region: 'Charlotte',
            'AVG(averageprice)__mean': 1.9405512820512825,
            'AVG(averageprice)__median': 1.9025,
            'AVG(averageprice)__max': 2.505,
            'AVG(averageprice)__min': 1.4775,
            'AVG(averageprice)__q1': 1.73875,
            'AVG(averageprice)__q3': 2.105,
            'AVG(averageprice)__count': 39,
            'AVG(averageprice)__outliers': [2.735],
          },
          {
            type: 'organic',
            region: 'Hartford Springfield',
            'AVG(averageprice)__mean': 2.231141025641026,
            'AVG(averageprice)__median': 2.265,
            'AVG(averageprice)__max': 2.595,
            'AVG(averageprice)__min': 1.862,
            'AVG(averageprice)__q1': 2.1285,
            'AVG(averageprice)__q3': 2.32625,
            'AVG(averageprice)__count': 39,
            'AVG(averageprice)__outliers': [],
          },
        ],
      },
    ] as QuerySeriesData[],
    theme: supersetTheme,
  });

  const charlotteDensity: [number, number][] = [
    [1.4775, 0],
    [1.7, 0.45],
    [1.9025, 1],
    [2.2, 0.55],
    [2.735, 0.1],
  ];

  const hartfordDensity: [number, number][] = [
    [1.862, 0],
    [2.1285, 0.4],
    [2.265, 0.35],
    [2.595, 0.1],
  ];
  const densityQueryData = [
    {
      data: [
        {
          type: 'organic',
          region: 'Charlotte',
          'AVG(averageprice)__mean': 1.9405512820512825,
          'AVG(averageprice)__median': 1.9025,
          'AVG(averageprice)__max': 2.505,
          'AVG(averageprice)__min': 1.4775,
          'AVG(averageprice)__q1': 1.73875,
          'AVG(averageprice)__q3': 2.105,
          'AVG(averageprice)__count': 39,
          'AVG(averageprice)__outliers': [2.735],
          'AVG(averageprice)__density': charlotteDensity,
        },
        {
          type: 'organic',
          region: 'Hartford Springfield',
          'AVG(averageprice)__mean': 2.231141025641026,
          'AVG(averageprice)__median': 2.265,
          'AVG(averageprice)__max': 2.595,
          'AVG(averageprice)__min': 1.862,
          'AVG(averageprice)__q1': 2.1285,
          'AVG(averageprice)__q3': 2.32625,
          'AVG(averageprice)__count': 39,
          'AVG(averageprice)__outliers': [],
          'AVG(averageprice)__density': hartfordDensity,
        },
      ],
    },
  ]


  const withDensity = () =>
    (chartProps.queriesData[0].data as QueryData[]).map((row, i) => ({
      ...row,
      'AVG(averageprice)__density':
        i === 0 ? charlotteDensity : hartfordDensity,
    }));

  const buildChartProps = (formDataOverrides: Partial<SqlaFormData> = {}) =>
    new ChartProps({
      formData: { ...formData, ...formDataOverrides },
      width: 800,
      height: 600,
      queriesData: chartProps.queriesData,
      theme: supersetTheme,
    }) as EchartsBoxPlotChartProps;


  //add a new version of build chart props, where we can dynamically modify the query data to reflect box or violin plots  
  const buildChartPropsExt = (
    formDataOverrides: Partial<SqlaFormData> = {},
    queriesData?: QuerySeriesData[],
    filterState?: { selectedValues: string[] },
  ) =>
    new ChartProps({
      formData: { ...formData, ...formDataOverrides },
      width: 800,
      height: 600,
      queriesData: queriesData ?? chartProps.queriesData,
      filterState,
      theme: supersetTheme,
    }) as unknown as EchartsBoxPlotChartProps;

  test('should transform chart props for viz', () => {
    expect(transformProps(chartProps as EchartsBoxPlotChartProps)).toEqual(
      expect.objectContaining({
        width: 800,
        height: 600,
        echartOptions: expect.objectContaining({
          dataZoom: expect.arrayContaining([
            {
              moveOnMouseWheel: true,
              type: 'inside',
              zoomOnMouseWheel: false,
            },
          ]),
          series: expect.arrayContaining([
            expect.objectContaining({
              name: 'boxplot',
              data: expect.arrayContaining([
                expect.objectContaining({
                  name: 'organic, Charlotte',
                  value: [
                    1.4775,
                    1.73875,
                    1.9025,
                    2.105,
                    2.505,
                    1.9405512820512825,
                    39,
                    [2.735],
                  ],
                }),
                expect.objectContaining({
                  name: 'organic, Hartford Springfield',
                  value: [
                    1.862,
                    2.1285,
                    2.265,
                    2.32625,
                    2.595,
                    2.231141025641026,
                    39,
                    [],
                  ],
                }),
              ]),
            }),
            expect.objectContaining({
              name: 'outlier',
              data: [['organic, Charlotte', 2.735]],
            }),
          ]),
        }),
      }),
    );
  });

  test('should add a vertical Y-axis slider to dataZoom when yAxisSlider is enabled', () => {
    const { echartOptions } = transformProps(
      buildChartProps({ yAxisSlider: true }),
    );
    expect((echartOptions as any).dataZoom).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'slider',
          show: true,
          yAxisIndex: [0],
          filterMode: 'none',
        }),
      ]),
    );
  });

  test('should not add a Y-axis slider when yAxisSlider is disabled', () => {
    const { echartOptions } = transformProps(
      buildChartProps({ yAxisSlider: false }),
    );
    expect((echartOptions as any).dataZoom).not.toContainEqual(
      expect.objectContaining({ type: 'slider' }),
    );
  });

  test('should combine zoomable and yAxisSlider dataZoom entries', () => {
    const { echartOptions } = transformProps(
      buildChartProps({ zoomable: true, yAxisSlider: true }),
    );
    expect((echartOptions as any).dataZoom).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'inside' }),
        expect.objectContaining({ type: 'slider', yAxisIndex: [0] }),
      ]),
    );
  });

  //violin test
  test('box mode ignores __density', () => {
    //create plot props without density metric in query series
    const withoutDensity = transformProps(buildChartPropsExt({ distributionStyle: 'box' }));
    //create props including the density metric in query series
    const withUnusedDensity = transformProps(
      buildChartPropsExt({ distributionStyle: 'box' }, [
        { data: withDensity() },
      ]),
    );
    const withDensityEchartOptions = withUnusedDensity.echartOptions as any;
    const withoutDensityEchartOptions = withoutDensity.echartOptions as any;
    //assert that the relevant props will be the same, because violinPlot distribution style was not specified
    expect(withDensityEchartOptions.series.map((s: any) => s.data)).toEqual(withoutDensityEchartOptions.series.map((s: any) => s.data));
    expect(withDensityEchartOptions.series.map((s: any) => s.type)).toEqual(withoutDensityEchartOptions.series.map((s: any) => s.type));
    expect(withDensityEchartOptions.xAxis.data).toEqual(withoutDensityEchartOptions.xAxis.data);
    expect(withUnusedDensity.labelMap).toEqual(withoutDensity.labelMap);
  });

  test('missing distribution style defaults to box', () => {
    //create plot props with density metric in the query series, without specifying the distribution style
    const plotProps = transformProps(buildChartPropsExt([
      { data: withDensity() }
    ]));
    //get the series
    const series = (plotProps.echartOptions as any).series;
    //assert that the series name and type is 'boxplot'
    expect(series[0].name).toBe('boxplot');
    expect(series[0].type).toBe('boxplot');
  });

  test('should return a violin plot when distribution style is specified as violin', () => {
    //create plot props with density metric in the query series and specifying the distribution style as violin
    const plotProps = transformProps(buildChartPropsExt({ distributionStyle: 'violin' }, [
      { data: withDensity() }
    ]));
    //get the series
    const series = (plotProps.echartOptions as any).series;
    //assert that the series name is 'violin plot'
    expect(series[0].name).toBe('violin');
    //assert that the series type is 'custom'
    expect(series[0].type).toBe('custom');
  });
})
